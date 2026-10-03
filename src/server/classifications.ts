import type { Classification } from '../shared/types.ts'
import { all, get, nowIso, run } from './db.ts'
import type { SenderClassification } from './ai/classify.ts'

interface ClassificationRow {
  id: number
  scan_id: number
  sender_email: string
  labels: string
  confidence: number | null
  rationale: string | null
  status: string
  source: string
  model: string | null
  display_name: string | null
  domain: string | null
  message_count: number | null
  unread_count: number | null
  sample_subjects: string | null
  last_seen: string | null
}

function rowToClassification(row: ClassificationRow): Classification {
  return {
    id: row.id,
    scanId: row.scan_id,
    senderEmail: row.sender_email,
    labels: safeArray(row.labels),
    confidence: row.confidence,
    rationale: row.rationale,
    status: row.status as Classification['status'],
    source: row.source as Classification['source'],
    model: row.model,
    sender: {
      id: 0,
      scanId: row.scan_id,
      email: row.sender_email,
      displayName: row.display_name,
      domain: row.domain,
      messageCount: row.message_count ?? 0,
      unreadCount: row.unread_count ?? 0,
      sampleSubjects: safeArray(row.sample_subjects ?? '[]'),
      lastSeen: row.last_seen,
    },
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

export function listClassifications(scanId: number): Classification[] {
  return all<ClassificationRow>(
    `SELECT c.*, s.display_name, s.domain, s.message_count, s.unread_count, s.sample_subjects, s.last_seen
     FROM classifications c
     LEFT JOIN senders s ON s.scan_id = c.scan_id AND s.email = c.sender_email
     WHERE c.scan_id = ?
     ORDER BY COALESCE(c.confidence, 0) DESC, s.message_count DESC`,
    scanId,
  ).map(rowToClassification)
}

/** Persist AI results and create empty rows for senders the model did not answer. */
export function saveClassifications(
  scanId: number,
  accountId: number,
  results: SenderClassification[],
  model: string | null,
): void {
  const now = nowIso()
  for (const result of results) {
    run(
      `INSERT INTO classifications
         (scan_id, account_id, sender_email, labels, confidence, rationale, status, source, model, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'suggested', 'ai', ?, ?)
       ON CONFLICT(scan_id, sender_email) DO UPDATE SET
         labels = excluded.labels, confidence = excluded.confidence,
         rationale = excluded.rationale, status = 'suggested', source = 'ai',
         model = excluded.model, updated_at = excluded.updated_at`,
      scanId,
      accountId,
      result.senderEmail,
      JSON.stringify(result.labels),
      result.confidence,
      result.rationale,
      model,
      now,
    )
  }

  // Senders without an answer still need a review row.
  const senders = all<{ email: string }>('SELECT email FROM senders WHERE scan_id = ?', scanId)
  const answered = new Set(results.map((r) => r.senderEmail))
  for (const sender of senders) {
    if (answered.has(sender.email)) continue
    run(
      `INSERT OR IGNORE INTO classifications
         (scan_id, account_id, sender_email, labels, confidence, rationale, status, source, updated_at)
       VALUES (?, ?, ?, '[]', 0, 'No suggestion from the model.', 'suggested', 'ai', ?)`,
      scanId,
      accountId,
      sender.email,
      now,
    )
  }
}

export function updateClassification(
  id: number,
  patch: { labels?: string[]; status?: Classification['status'] },
): Classification {
  const row = get<ClassificationRow>('SELECT * FROM classifications WHERE id = ?', id)
  if (!row) throw new Error('Classification not found.')

  const labels = patch.labels ? JSON.stringify(patch.labels) : null
  const status = patch.status ?? (patch.labels ? 'edited' : row.status)
  run(
    `UPDATE classifications SET
       labels = COALESCE(?, labels),
       status = ?,
       source = CASE WHEN ? = 'edited' THEN 'manual' ELSE source END,
       updated_at = ?
     WHERE id = ?`,
    labels,
    status,
    status,
    nowIso(),
    id,
  )
  const updated = get<ClassificationRow>('SELECT * FROM classifications WHERE id = ?', id)
  if (!updated) throw new Error('Failed to update classification.')
  return rowToClassification(updated)
}

/** Bulk-update the review status of a scan (optionally only for given row ids). */
export function markClassifications(
  scanId: number,
  status: Classification['status'],
  ids?: number[],
): void {
  const now = nowIso()
  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    run(
      `UPDATE classifications SET status = ?, updated_at = ?
       WHERE scan_id = ? AND id IN (${placeholders})`,
      status,
      now,
      scanId,
      ...ids,
    )
  } else {
    run('UPDATE classifications SET status = ?, updated_at = ? WHERE scan_id = ?', status, now, scanId)
  }
}

export interface AcceptedMapping {
  senderEmail: string
  labels: string[]
}

/** Labels chosen for every accepted/edited classification of a scan. */
export function getAcceptedMappings(scanId: number): AcceptedMapping[] {
  const rows = all<{ sender_email: string; labels: string }>(
    "SELECT sender_email, labels FROM classifications WHERE scan_id = ? AND status IN ('accepted','edited')",
    scanId,
  )
  return rows
    .map((r) => ({ senderEmail: r.sender_email, labels: safeArray(r.labels) }))
    .filter((r) => r.labels.length > 0)
}
