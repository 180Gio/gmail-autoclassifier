import type { GmailFilter } from '../../shared/types.ts'
import { all, nowIso, run } from '../db.ts'
import { getGmail } from './oauth.ts'
import { withRetry } from './retry.ts'

/**
 * List every filter configured in Gmail (including ones created outside this
 * app), resolving label ids to human-readable names.
 */
export async function listGmailFilters(accountId: number): Promise<GmailFilter[]> {
  const gmail = getGmail(accountId)
  const [filtersRes, labelsRes] = await Promise.all([
    withRetry(() => gmail.users.settings.filters.list({ userId: 'me' })),
    withRetry(() => gmail.users.labels.list({ userId: 'me' })),
  ])

  const nameById = new Map<string, string>()
  for (const label of labelsRes.data.labels ?? []) {
    if (label.id && label.name) nameById.set(label.id, label.name)
  }

  const ruleRows = all<{ id: number; gmail_filter_id: string }>(
    'SELECT id, gmail_filter_id FROM rules WHERE account_id = ? AND gmail_filter_id IS NOT NULL',
    accountId,
  )
  const ruleByFilter = new Map(ruleRows.map((r) => [r.gmail_filter_id, r.id]))

  const resolve = (ids: string[] | null | undefined): string[] =>
    (ids ?? []).map((id) => nameById.get(id) ?? id)

  return (filtersRes.data.filter ?? []).map((filter) => {
    const id = filter.id ?? ''
    const criteria = filter.criteria
    const action = filter.action
    return {
      id,
      from: criteria?.from ?? null,
      to: criteria?.to ?? null,
      subject: criteria?.subject ?? null,
      query: criteria?.query ?? null,
      negatedQuery: criteria?.negatedQuery ?? null,
      hasAttachment: Boolean(criteria?.hasAttachment),
      addLabels: resolve(action?.addLabelIds),
      removeLabels: resolve(action?.removeLabelIds),
      forward: action?.forward ?? null,
      createdByApp: ruleByFilter.has(id),
      ruleId: ruleByFilter.get(id) ?? null,
    }
  })
}

/** Delete any Gmail filter by id; if it belongs to a local rule, mark that rule deleted. */
export async function deleteGmailFilter(accountId: number, filterId: string): Promise<void> {
  const gmail = getGmail(accountId)
  try {
    await withRetry(() => gmail.users.settings.filters.delete({ userId: 'me', id: filterId }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/404|not found/i.test(message)) throw error
  }
  run(
    "UPDATE rules SET status = 'deleted', updated_at = ? WHERE account_id = ? AND gmail_filter_id = ?",
    nowIso(),
    accountId,
    filterId,
  )
}
