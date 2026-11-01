import { Router } from 'express'
import type { ConfigExport } from '../../shared/types.ts'
import { nowIso, run } from '../db.ts'
import { HttpError, requireAccount } from '../http.ts'
import { listRules } from '../gmail/apply.ts'
import { createLocalLabel, getLabelByName, listLabels, updateLabel } from '../gmail/labels.ts'
import { getSettingsView, saveSettings } from '../settings.ts'

export const configRouter: Router = Router()

/** Export labels, rule history and non-secret settings (never secrets/tokens). */
configRouter.get('/config/export', (_req, res) => {
  const account = requireAccount()

  const labels = listLabels(account.id)
    .filter((label) => label.kind === 'user')
    .map((label) => ({ name: label.name, description: label.description, kind: label.kind }))

  const rules = listRules(account.id).map((rule) => ({
    labelNames: rule.labelNames,
    senderEmail: rule.senderEmail,
    query: rule.query,
    actions: rule.actions,
    status: rule.status,
    createdAt: rule.createdAt,
  }))

  const settings: Record<string, string> = {}
  for (const setting of getSettingsView()) {
    if (setting.type !== 'secret' && setting.value !== null) settings[setting.key] = setting.value
  }

  const payload: ConfigExport = {
    app: 'gmail-autoclassifier',
    version: 1,
    exportedAt: nowIso(),
    labels,
    rules,
    settings,
  }
  res.json(payload)
})

/** Restore labels, non-secret settings and rule history. Does not create Gmail filters. */
configRouter.post('/config/import', (req, res) => {
  const account = requireAccount()
  const data = (req.body ?? {}) as Partial<ConfigExport>
  if (data.app !== 'gmail-autoclassifier') {
    throw new HttpError(400, 'Not a Gmail AutoClassifier configuration file.')
  }

  let labelsImported = 0
  for (const label of data.labels ?? []) {
    if (!label?.name) continue
    const existing = getLabelByName(account.id, label.name)
    if (existing) {
      if (label.description) updateLabel(account.id, existing.id, { description: label.description })
    } else {
      createLocalLabel(account.id, label.name, label.description ?? '')
    }
    labelsImported += 1
  }

  if (data.settings && typeof data.settings === 'object') {
    saveSettings(data.settings as Record<string, unknown>)
  }

  let rulesImported = 0
  for (const rule of data.rules ?? []) {
    run(
      `INSERT INTO rules
         (account_id, gmail_filter_id, label_names, sender_email, query, actions, backfill, status, error, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, 0, 'deleted', ?, ?, ?)`,
      account.id,
      JSON.stringify(rule.labelNames ?? []),
      rule.senderEmail ?? null,
      rule.query ?? null,
      JSON.stringify(rule.actions ?? {}),
      'Imported from a backup; no Gmail filter was created.',
      rule.createdAt ?? nowIso(),
      nowIso(),
    )
    rulesImported += 1
  }

  res.json({ labelsImported, rulesImported })
})
