import type { Rule, RuleActions } from '../../shared/types.ts'
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

  // label -> senders
  const byLabel = new Map<string, string[]>()
  for (const mapping of mappings) {
    for (const label of mapping.labels) {
      const list = byLabel.get(label) ?? []
      list.push(mapping.senderEmail)
      byLabel.set(label, list)
    }
  }
  if (byLabel.size === 0) return result

  const existingFrom = await loadExistingFrom(accountId)
  const maxPerFilter = Math.max(1, Math.min(200, getNumber('filters.maxSendersPerFilter', 50)))
  const removeLabelIds = buildRemoveLabelIds(options)

  for (const [label, sendersRaw] of byLabel) {
    const senders = [...new Set(sendersRaw)]
    try {
      if (!getLabelByName(accountId, label)) createLocalLabel(accountId, label, '')
      const labelId = await ensureGmailLabelId(accountId, gmail, label)

      for (let i = 0; i < senders.length; i += maxPerFilter) {
        const chunk = senders.slice(i, i + maxPerFilter)
        const fromQuery = chunk.join(' OR ')
        if (existingFrom.has(fromQuery)) continue

        try {
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
          existingFrom.add(fromQuery)
          result.rulesCreated += 1

          if (options.applyToExisting) {
            const count = await backfill(gmail, chunk, [labelId], removeLabelIds)
            run('UPDATE rules SET backfill_count = ?, updated_at = ? WHERE id = ?', count, nowIso(), lastId)
            result.messagesBackfilled += count
          }
        } catch (error) {
          result.errors.push({
            sender: `${label} (${chunk.length} senders)`,
            message: errMsg(error),
          })
        }
      }
    } catch (error) {
      result.errors.push({ sender: label, message: errMsg(error) })
    }
  }

  return result
}

async function loadExistingFrom(accountId: number): Promise<Set<string>> {
  const set = new Set<string>()
  try {
    for (const filter of await listGmailFilters(accountId)) {
      if (filter.from) set.add(filter.from.trim())
    }
  } catch {
    // Non-fatal: worst case we try to create a duplicate and Gmail rejects it.
  }
  return set
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
