import type { Scan, Sender } from '../../shared/types.ts'
import { all, get, nowIso, run } from '../db.ts'
import { getNumber } from '../settings.ts'
import { getGmail, type Gmail } from './oauth.ts'
import { isQuotaError, withRetry } from './retry.ts'

interface ScanRow {
  id: number
  account_id: number
  status: string
  query: string | null
  months: number
  max_messages: number
  messages_fetched: number
  senders_found: number
  error: string | null
  started_at: string
  finished_at: string | null
}

function rowToScan(row: ScanRow): Scan {
  return {
    id: row.id,
    accountId: row.account_id,
    status: row.status as Scan['status'],
    query: row.query,
    months: row.months,
    maxMessages: row.max_messages,
    messagesFetched: row.messages_fetched,
    sendersFound: row.senders_found,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

export interface StartScanOptions {
  months: number
  maxMessages: number
  query?: string
}

const runningScans = new Set<number>()

export function getScan(scanId: number): Scan | null {
  const row = get<ScanRow>('SELECT * FROM scans WHERE id = ?', scanId)
  return row ? rowToScan(row) : null
}

export function listScans(accountId: number, limit = 20): Scan[] {
  return all<ScanRow>(
    'SELECT * FROM scans WHERE account_id = ? ORDER BY id DESC LIMIT ?',
    accountId,
    limit,
  ).map(rowToScan)
}

interface SenderRow {
  id: number
  scan_id: number
  email: string
  display_name: string | null
  domain: string | null
  message_count: number
  unread_count: number
  sample_subjects: string
  last_seen: string | null
}

export function getSenders(scanId: number): Sender[] {
  return all<SenderRow>(
    'SELECT * FROM senders WHERE scan_id = ? ORDER BY message_count DESC',
    scanId,
  ).map((r) => ({
    id: r.id,
    scanId: r.scan_id,
    email: r.email,
    displayName: r.display_name,
    domain: r.domain,
    messageCount: r.message_count,
    unreadCount: r.unread_count,
    sampleSubjects: safeArray(r.sample_subjects),
    lastSeen: r.last_seen,
  }))
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** Create a scan row and start processing it in the background. */
export function startScan(accountId: number, options: StartScanOptions): Scan {
  if (runningScans.has(accountId)) {
    throw new Error('A scan is already running for this account.')
  }
  const months = Math.max(1, Math.min(120, Math.round(options.months)))
  const maxMessages = Math.max(50, Math.min(50000, Math.round(options.maxMessages)))
  const now = nowIso()
  const { lastId } = run(
    `INSERT INTO scans (account_id, status, query, months, max_messages, started_at)
     VALUES (?, 'running', ?, ?, ?, ?)`,
    accountId,
    options.query?.trim() || null,
    months,
    maxMessages,
    now,
  )
  const scan = getScan(lastId)
  if (!scan) throw new Error('Failed to create scan.')

  runningScans.add(accountId)
  void runScan(scan.id, accountId).finally(() => runningScans.delete(accountId))
  return scan
}

async function runScan(scanId: number, accountId: number): Promise<void> {
  try {
    const scan = getScan(scanId)
    if (!scan) return
    const gmail = getGmail(accountId)

    const query = buildQuery(scan.months, scan.query)
    const ids = await listMessageIds(gmail, query, scan.maxMessages)
    updateScan(scanId, { messages_fetched: 0, senders_found: 0 })

    const aggregated = new Map<string, AggregatedSender>()
    let fetched = 0
    // Keep concurrency low by default: Gmail's per-user quota is easy to trip
    // with many parallel `messages.get` calls on large scans.
    const concurrency = Math.max(1, Math.min(16, getNumber('scan.concurrency', 4)))

    await mapPool(ids, concurrency, async (id) => {
      const message = await getMetadata(gmail, id)
      if (message) aggregate(aggregated, message)
      fetched += 1
      if (fetched % 50 === 0) {
        updateScan(scanId, { messages_fetched: fetched })
      }
    })

    // Replace any senders from a previous partial run of this scan.
    run('DELETE FROM senders WHERE scan_id = ?', scanId)
    const rows = [...aggregated.values()].sort((a, b) => b.count - a.count)
    for (const sender of rows) {
      run(
        `INSERT INTO senders
           (scan_id, account_id, email, display_name, domain, message_count, unread_count, sample_subjects, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        scanId,
        accountId,
        sender.email,
        sender.displayName,
        sender.domain,
        sender.count,
        sender.unread,
        JSON.stringify(sender.subjects),
        sender.lastSeen,
      )
    }

    updateScan(scanId, {
      status: 'done',
      messages_fetched: fetched,
      senders_found: rows.length,
      finished_at: nowIso(),
    })
  } catch (error) {
    const base = error instanceof Error ? error.message : String(error)
    const message = isQuotaError(error)
      ? `${base} — Gmail per-user quota reached. Wait a minute, then lower "Max messages" or "Concurrency" and scan again.`
      : base
    run(
      "UPDATE scans SET status = 'error', error = ?, finished_at = ? WHERE id = ?",
      message,
      nowIso(),
      scanId,
    )
  }
}

interface ScanPatch {
  status?: string
  messages_fetched?: number
  senders_found?: number
  finished_at?: string
}

function updateScan(scanId: number, patch: ScanPatch): void {
  const fields: string[] = []
  const params: Array<string | number> = []
  if (patch.status !== undefined) {
    fields.push('status = ?')
    params.push(patch.status)
  }
  if (patch.messages_fetched !== undefined) {
    fields.push('messages_fetched = ?')
    params.push(patch.messages_fetched)
  }
  if (patch.senders_found !== undefined) {
    fields.push('senders_found = ?')
    params.push(patch.senders_found)
  }
  if (patch.finished_at !== undefined) {
    fields.push('finished_at = ?')
    params.push(patch.finished_at)
  }
  if (fields.length === 0) return
  params.push(scanId)
  run(`UPDATE scans SET ${fields.join(', ')} WHERE id = ?`, ...params)
}

function buildQuery(months: number, extra: string | null): string {
  const base = `newer_than:${months}m`
  return extra ? `${base} ${extra}` : base
}

async function listMessageIds(gmail: Gmail, query: string, maxMessages: number): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(500, maxMessages - ids.length),
        pageToken,
      }),
    )
    for (const m of res.data.messages ?? []) {
      if (m.id) ids.push(m.id)
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken && ids.length < maxMessages)
  return ids.slice(0, maxMessages)
}

interface MessageMeta {
  from: { name: string | null; email: string } | null
  subject: string
  unread: boolean
  date: string | null
}

async function getMetadata(gmail: Gmail, id: string): Promise<MessageMeta | null> {
  const res = await withRetry(() =>
    gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    }),
  )
  const headers = res.data.payload?.headers ?? []
  const header = (name: string): string =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  const from = parseFrom(header('From'))
  if (!from) return null

  const internalDate = Number(res.data.internalDate ?? 0)
  return {
    from,
    subject: header('Subject').slice(0, 200),
    unread: (res.data.labelIds ?? []).includes('UNREAD'),
    date: internalDate ? new Date(internalDate).toISOString() : null,
  }
}

export function parseFrom(value: string): { name: string | null; email: string } | null {
  if (!value) return null
  const angle = value.match(/<([^>]+)>/)
  const rawEmail = (angle ? angle[1] : value).trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) return null

  let name: string | null = null
  if (angle) {
    const before = value.slice(0, value.indexOf('<')).trim().replace(/^"|"$/g, '')
    name = before || null
  }
  return { name, email: rawEmail }
}

interface AggregatedSender {
  email: string
  displayName: string | null
  domain: string
  count: number
  unread: number
  subjects: string[]
  lastSeen: string | null
}

function aggregate(map: Map<string, AggregatedSender>, meta: MessageMeta): void {
  if (!meta.from) return
  const { email, name } = meta.from
  const existing = map.get(email)
  if (!existing) {
    map.set(email, {
      email,
      displayName: name,
      domain: email.split('@')[1] ?? '',
      count: 1,
      unread: meta.unread ? 1 : 0,
      subjects: meta.subject ? [meta.subject] : [],
      lastSeen: meta.date,
    })
    return
  }
  existing.count += 1
  if (meta.unread) existing.unread += 1
  if (meta.subject && existing.subjects.length < 5 && !existing.subjects.includes(meta.subject)) {
    existing.subjects.push(meta.subject)
  }
  if (!existing.displayName && name) existing.displayName = name
  if (meta.date && (!existing.lastSeen || meta.date > existing.lastSeen)) existing.lastSeen = meta.date
}

/** Run an async worker over items with bounded concurrency. */
async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}
