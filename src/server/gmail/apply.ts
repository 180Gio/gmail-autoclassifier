import type { FilterPlan, FilterPlanItem, Rule, RuleActions } from '../../shared/types.ts'
import { all, get, nowIso, run } from '../db.ts'
import { getNumber } from '../settings.ts'
import type { AcceptedMapping } from '../classifications.ts'
import { listGmailFilters } from './filters.ts'
import { createLocalLabel, ensureGmailLabelId, getLabelByName } from './labels.ts'
import { getGmail, type Gmail } from './oauth.ts'
import { withRetry } from './retry.ts'
import { setGmailRequestsPerSecond } from './scheduler.ts'

export interface ApplyOptions {
  archive: boolean
  markRead: boolean
  neverSpam: boolean
  applyToExisting: boolean
  /** Labels whose senders should be grouped by domain (`from:@domain`). */
  domainLabels: string[]
}

export interface ApplyResult {
  rulesCreated: number
  messagesBackfilled: number
  errors: Array<{ sender: string; message: string }>
}

interface RuleRow {
  id: number
  account_id: number
  gmail_filter_id: string | null
  label_names: string
  sender_email: string | null
  domain: string | null
  query: string | null
  actions: string
  backfill: number
  backfill_count: number | null
  status: string
  error: string | null
  created_at: string
}

function rowToRule(row: RuleRow): Rule {
  return {
    id: row.id,
    accountId: row.account_id,
    gmailFilterId: row.gmail_filter_id,
    labelNames: safeArray(row.label_names),
    senderEmail: row.sender_email,
    domain: row.domain,
    query: row.query,
    actions: safeObject(row.actions),
    backfill: Boolean(row.backfill),
    backfillCount: row.backfill_count,
    status: row.status as Rule['status'],
    error: row.error,
    createdAt: row.created_at,
  }
}

function safeArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function safeObject(value: string): RuleActions {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed ? (parsed as RuleActions) : {}
  } catch {
    return {}
  }
}

export function listRules(accountId: number): Rule[] {
  return all<RuleRow>('SELECT * FROM rules WHERE account_id = ? ORDER BY id DESC', accountId).map(
    rowToRule,
  )
}

export interface FilterGroup {
  label: string
  senders: string[]
  fromQuery: string
}

/**
 * Group accepted senders by label and split each label into chunks.
 * Pure function so it can be unit-tested and reused by a dry-run preview.
 */
export function planFilters(
  mappings: AcceptedMapping[],
  maxSendersPerFilter: number,
  domainLabels: string[] = [],
): FilterGroup[] {
  const maxPerFilter = Math.max(1, Math.floor(maxSendersPerFilter) || 50)
  const domainSet = new Set(domainLabels)
  const byLabel = new Map<string, string[]>()
  for (const mapping of mappings) {
    for (const label of mapping.labels) {
      const value = domainSet.has(label) ? toDomain(mapping.senderEmail) : mapping.senderEmail
      const list = byLabel.get(label) ?? []
      list.push(value)
      byLabel.set(label, list)
    }
  }

  const groups: FilterGroup[] = []
  for (const [label, sendersRaw] of byLabel) {
    const senders = [...new Set(sendersRaw)]
    for (let i = 0; i < senders.length; i += maxPerFilter) {
      const chunk = senders.slice(i, i + maxPerFilter)
      groups.push({ label, senders: chunk, fromQuery: chunk.join(' OR ') })
    }
  }
  return groups
}

/** Turn `someone@sub.example.com` into `@sub.example.com`. */
export function toDomain(email: string): string {
  const at = email.lastIndexOf('@')
  return at >= 0 ? `@${email.slice(at + 1).toLowerCase()}` : email
}

/**
 * Create Gmail filters for the accepted senders.
 *
 * Senders are **grouped by label**: one filter per label (and per chunk of
 * `filters.maxSendersPerFilter` senders) with `from: a OR b OR …`, matching how
 * Gmail itself models filters. Existing filters with the same `from` are skipped.
 */
export async function applyRules(
  accountId: number,
  mappings: AcceptedMapping[],
  options: ApplyOptions,
): Promise<ApplyResult> {
  const gmail = getGmail(accountId)
  setGmailRequestsPerSecond(getNumber('scan.requestsPerSecond', 8))

  const result: ApplyResult = { rulesCreated: 0, messagesBackfilled: 0, errors: [] }

  const maxPerFilter = getNumber('filters.maxSendersPerFilter', 50)
  const groups = planFilters(mappings, maxPerFilter, options.domainLabels)
  if (groups.length === 0) return result

  const existing = await loadExisting(accountId)
  const removeLabelIds = buildRemoveLabelIds(options)
  const labelIds = new Map<string, string>()

  async function resolveLabelId(label: string): Promise<string> {
    const cached = labelIds.get(label)
    if (cached) return cached
    if (!getLabelByName(accountId, label)) createLocalLabel(accountId, label, '')
    const id = await ensureGmailLabelId(accountId, gmail, label)
    labelIds.set(label, id)
    return id
  }

  for (const group of groups) {
    const { label, senders, fromQuery } = group
    try {
      const labelId = await resolveLabelId(label)
      if (existing.fromSet.has(fromQuery)) continue

      const filter = await withRetry(() =>
        gmail.users.settings.filters.create({
          userId: 'me',
          requestBody: {
            criteria: { from: fromQuery },
            action: { addLabelIds: [labelId], removeLabelIds },
          },
        }),
      )

      const now = nowIso()
      const { lastId } = run(
        `INSERT INTO rules
           (account_id, gmail_filter_id, label_names, query, actions, backfill, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        accountId,
        filter.data.id ?? null,
        JSON.stringify([label]),
        fromQuery,
        JSON.stringify({
          archive: options.archive,
          markRead: options.markRead,
          neverSpam: options.neverSpam,
        }),
        options.applyToExisting ? 1 : 0,
        now,
        now,
      )
      existing.fromSet.add(fromQuery)
      result.rulesCreated += 1

      if (options.applyToExisting) {
        const count = await backfill(gmail, senders, [labelId], removeLabelIds)
        run('UPDATE rules SET backfill_count = ?, updated_at = ? WHERE id = ?', count, nowIso(), lastId)
        result.messagesBackfilled += count
      }
    } catch (error) {
      result.errors.push({
        sender: `${label} (${senders.length} senders)`,
        message: errMsg(error),
      })
    }
  }

  return result
}

/**
 * Compute the filters that would be created, without writing anything to Gmail.
 * Also flags senders already matched by an existing filter (task: avoid overlaps).
 */
export async function planApply(
  accountId: number,
  mappings: AcceptedMapping[],
  options: ApplyOptions,
): Promise<FilterPlan> {
  const maxPerFilter = getNumber('filters.maxSendersPerFilter', 50)
  const groups = planFilters(mappings, maxPerFilter, options.domainLabels)
  const existing = await loadExisting(accountId)
  const removeLabelIds = buildRemoveLabelIds(options)

  const covered = new Set<string>()
  const items: FilterPlanItem[] = groups.map((group) => {
    const coveredSenders = group.senders.filter((s) => existing.senderSet.has(s.toLowerCase()))
    for (const sender of coveredSenders) covered.add(sender)
    return {
      ...group,
      alreadyExists: existing.fromSet.has(group.fromQuery),
      coveredSenders,
    }
  })

  return {
    groups: items,
    totalSenders: new Set(mappings.map((m) => m.senderEmail)).size,
    totalFilters: items.length,
    coveredSenders: covered.size,
    removeLabelIds,
    options,
  }
}

/** Extract individual sender addresses from a Gmail filter `from` value (OR list). */
export function parseFilterSenders(from: string | null): string[] {
  if (!from) return []
  return from
    .split(/\s+OR\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((email) => email.includes('@'))
}

interface ExistingFilters {
  /** Exact `from` criteria already present in Gmail. */
  fromSet: Set<string>
  /** Individual sender addresses already matched by existing filters. */
  senderSet: Set<string>
}

async function loadExisting(accountId: number): Promise<ExistingFilters> {
  const fromSet = new Set<string>()
  const senderSet = new Set<string>()
  // Do not swallow errors here: if Gmail is unreachable or the token expired,
  // the plan/apply must fail clearly instead of pretending nothing is covered.
  for (const filter of await listGmailFilters(accountId)) {
    if (!filter.from) continue
    fromSet.add(filter.from.trim())
    for (const email of parseFilterSenders(filter.from)) senderSet.add(email)
  }
  return { fromSet, senderSet }
}

function buildRemoveLabelIds(options: ApplyOptions): string[] {
  const ids: string[] = []
  // Archive = skip the inbox.
  if (options.archive) ids.push('INBOX')
  // Mark as read.
  if (options.markRead) ids.push('UNREAD')
  // "Never send it to Spam".
  if (options.neverSpam) ids.push('SPAM')
  return ids
}

/** Apply label changes to existing messages from a group of senders (capped). */
async function backfill(
  gmail: Gmail,
  senders: string[],
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<number> {
  const CAP = 5000
  const query = senders.map((s) => `from:${s}`).join(' OR ')
  let total = 0
  let pageToken: string | undefined
  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken,
      }),
    )
    const ids = (res.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
    if (ids.length > 0) {
      await withRetry(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: { ids, addLabelIds, removeLabelIds },
        }),
      )
      total += ids.length
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken && total < CAP)
  return total
}

/** Delete the Gmail filter behind a rule (keeps the label itself). */
export async function deleteRule(accountId: number, ruleId: number): Promise<void> {
  const row = get<RuleRow>('SELECT * FROM rules WHERE id = ? AND account_id = ?', ruleId, accountId)
  if (!row) throw new Error('Rule not found.')

  if (row.gmail_filter_id) {
    try {
      const gmail = getGmail(accountId)
      await withRetry(() => gmail.users.settings.filters.delete({ userId: 'me', id: row.gmail_filter_id! }))
    } catch (error) {
      // A 404 just means the filter was already removed in Gmail.
      if (!/404|not found/i.test(errMsg(error))) throw error
    }
  }
  run("UPDATE rules SET status = 'deleted', updated_at = ? WHERE id = ?", nowIso(), ruleId)
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
