import type { Rule, RuleActions } from '../../shared/types.ts'
import { all, get, nowIso, run } from '../db.ts'
import type { AcceptedMapping } from '../classifications.ts'
import { createLocalLabel, ensureGmailLabelId, getLabelByName } from './labels.ts'
import { getGmail, type Gmail } from './oauth.ts'
import { withRetry } from './retry.ts'

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
  return all<RuleRow>(
    'SELECT * FROM rules WHERE account_id = ? ORDER BY id DESC',
    accountId,
  ).map(rowToRule)
}

/** Create Gmail filters (and optionally backfill existing mail) for accepted senders. */
export async function applyRules(
  accountId: number,
  mappings: AcceptedMapping[],
  options: ApplyOptions,
): Promise<ApplyResult> {
  const gmail = getGmail(accountId)
  const result: ApplyResult = { rulesCreated: 0, messagesBackfilled: 0, errors: [] }

  for (const mapping of mappings) {
    try {
      const labelIds: string[] = []
      for (const name of mapping.labels) {
        // Make sure a local row exists so descriptions survive.
        if (!getLabelByName(accountId, name)) createLocalLabel(accountId, name, '')
        labelIds.push(await ensureGmailLabelId(accountId, gmail, name))
      }
      if (labelIds.length === 0) continue

      const removeLabelIds = buildRemoveLabelIds(options)
      const filter = await withRetry(() =>
        gmail.users.settings.filters.create({
          userId: 'me',
          requestBody: {
            criteria: { from: mapping.senderEmail },
            action: { addLabelIds: labelIds, removeLabelIds },
          },
        }),
      )

      const now = nowIso()
      const { lastId } = run(
        `INSERT INTO rules
           (account_id, gmail_filter_id, label_names, sender_email, actions, backfill, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        accountId,
        filter.data.id ?? null,
        JSON.stringify(mapping.labels),
        mapping.senderEmail,
        JSON.stringify({
          archive: options.archive,
          markRead: options.markRead,
          neverSpam: options.neverSpam,
        }),
        options.applyToExisting ? 1 : 0,
        now,
        now,
      )
      result.rulesCreated += 1

      if (options.applyToExisting) {
        const count = await backfill(gmail, mapping.senderEmail, labelIds, removeLabelIds)
        run(
          'UPDATE rules SET backfill_count = ?, updated_at = ? WHERE id = ?',
          count,
          nowIso(),
          lastId,
        )
        result.messagesBackfilled += count
      }
    } catch (error) {
      result.errors.push({
        sender: mapping.senderEmail,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
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

/** Apply label changes to existing messages from a sender (capped for safety). */
async function backfill(
  gmail: Gmail,
  senderEmail: string,
  addLabelIds: string[],
  removeLabelIds: string[],
): Promise<number> {
  const CAP = 5000
  let total = 0
  let pageToken: string | undefined
  do {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: `from:${senderEmail}`,
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
      const message = error instanceof Error ? error.message : String(error)
      if (!/404|not found/i.test(message)) throw error
    }
  }
  run("UPDATE rules SET status = 'deleted', updated_at = ? WHERE id = ?", nowIso(), ruleId)
}
