import type { Label, LabelKind } from '../../shared/types.ts'
import { all, get, nowIso, run } from '../db.ts'
import type { Gmail } from './oauth.ts'

interface LabelRow {
  id: number
  account_id: number
  gmail_id: string | null
  name: string
  description: string
  kind: string
  created_by_app: number
  color: string | null
}

function rowToLabel(row: LabelRow): Label {
  return {
    id: row.id,
    accountId: row.account_id,
    gmailId: row.gmail_id,
    name: row.name,
    description: row.description,
    kind: row.kind as LabelKind,
    createdByApp: Boolean(row.created_by_app),
    color: row.color,
  }
}

export function listLabels(accountId: number): Label[] {
  return all<LabelRow>(
    "SELECT * FROM labels WHERE account_id = ? ORDER BY (kind = 'system'), name COLLATE NOCASE",
    accountId,
  ).map(rowToLabel)
}

export function getLabelByName(accountId: number, name: string): Label | undefined {
  const row = get<LabelRow>(
    'SELECT * FROM labels WHERE account_id = ? AND name = ? COLLATE NOCASE',
    accountId,
    name,
  )
  return row ? rowToLabel(row) : undefined
}

/** Pull labels from Gmail into the local table, preserving existing descriptions. */
export async function syncLabelsFromGmail(accountId: number, gmail: Gmail): Promise<Label[]> {
  const res = await gmail.users.labels.list({ userId: 'me' })
  const gmailLabels = res.data.labels ?? []
  const now = nowIso()
  for (const label of gmailLabels) {
    if (!label.id || !label.name) continue
    run(
      `INSERT INTO labels (account_id, gmail_id, name, kind, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, name) DO UPDATE SET
         gmail_id   = excluded.gmail_id,
         kind       = excluded.kind,
         color      = excluded.color,
         updated_at = excluded.updated_at`,
      accountId,
      label.id,
      label.name,
      label.type === 'system' ? 'system' : 'user',
      label.color?.backgroundColor ?? null,
      now,
      now,
    )
  }
  return listLabels(accountId)
}

export function createLocalLabel(accountId: number, name: string, description: string): Label {
  const clean = name.trim()
  if (!clean) throw new Error('Label name is required.')
  const now = nowIso()
  run(
    `INSERT INTO labels (account_id, name, description, kind, created_by_app, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, ?, ?)`,
    accountId,
    clean,
    description.trim(),
    now,
    now,
  )
  const created = getLabelByName(accountId, clean)
  if (!created) throw new Error('Failed to create label.')
  return created
}

export function updateLabel(
  accountId: number,
  id: number,
  patch: { name?: string; description?: string },
): Label {
  const current = get<LabelRow>('SELECT * FROM labels WHERE id = ? AND account_id = ?', id, accountId)
  if (!current) throw new Error('Label not found.')
  const name = patch.name?.trim() || current.name
  const description = patch.description ?? current.description
  run(
    'UPDATE labels SET name = ?, description = ?, updated_at = ? WHERE id = ? AND account_id = ?',
    name,
    description,
    nowIso(),
    id,
    accountId,
  )
  const updated = getLabelByName(accountId, name)
  if (!updated) throw new Error('Failed to update label.')
  return updated
}

function setGmailId(accountId: number, name: string, gmailId: string, createdByApp: boolean): void {
  run(
    `UPDATE labels SET gmail_id = ?, created_by_app = ?, updated_at = ?
     WHERE account_id = ? AND name = ? COLLATE NOCASE`,
    gmailId,
    createdByApp ? 1 : 0,
    nowIso(),
    accountId,
    name,
  )
}

/**
 * Return the Gmail label id for `name`, creating the label (and any parent in
 * a nested "Parent/Child" name) if it does not exist yet.
 */
export async function ensureGmailLabelId(
  accountId: number,
  gmail: Gmail,
  name: string,
): Promise<string> {
  const clean = name.trim()
  const local = getLabelByName(accountId, clean)
  if (local?.gmailId) return local.gmailId

  // Refresh from Gmail once in case the label already exists server-side.
  const listed = await gmail.users.labels.list({ userId: 'me' })
  const existing = (listed.data.labels ?? []).find(
    (l) => l.name?.toLowerCase() === clean.toLowerCase(),
  )
  if (existing?.id) {
    setGmailId(accountId, clean, existing.id, false)
    return existing.id
  }

  // Ensure the parent label exists for nested names.
  const slash = clean.lastIndexOf('/')
  if (slash > 0) {
    await ensureGmailLabelId(accountId, gmail, clean.slice(0, slash))
  }

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name: clean, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  })
  const gmailId = created.data.id
  if (!gmailId) throw new Error(`Failed to create Gmail label "${clean}".`)
  setGmailId(accountId, clean, gmailId, true)
  return gmailId
}
