import { Router } from 'express'
import type { ClassificationStatus } from '../../shared/types.ts'
import { classifySenders, type ClassifyLabelInput, type ClassifySenderInput } from '../ai/classify.ts'
import {
  getAcceptedMappings,
  listClassifications,
  markClassifications,
  saveClassifications,
  updateClassification,
} from '../classifications.ts'
import { HttpError, requireAccount } from '../http.ts'
import { applyRules, listRules, type ApplyOptions } from '../gmail/apply.ts'
import { listLabels } from '../gmail/labels.ts'
import { getScan, getSenders, listScans, startScan } from '../gmail/scan.ts'
import { getAiProviderId, getBool, getSetting } from '../settings.ts'

export const scansRouter: Router = Router()

scansRouter.get('/scans', (_req, res) => {
  const account = requireAccount()
  res.json({ scans: listScans(account.id) })
})

scansRouter.post('/scans', (req, res) => {
  const account = requireAccount()
  const body = (req.body ?? {}) as { months?: number; maxMessages?: number; query?: string }
  const scan = startScan(account.id, {
    months: Number(body.months) || Number(getSetting('scan.months')) || 6,
    maxMessages: Number(body.maxMessages) || Number(getSetting('scan.maxMessages')) || 2000,
    query: body.query,
  })
  res.status(202).json({ scan })
})

function requireScan(scanId: number, accountId: number) {
  const scan = getScan(scanId)
  if (!scan || scan.accountId !== accountId) throw new HttpError(404, 'Scan not found.')
  return scan
}

scansRouter.get('/scans/:id', (req, res) => {
  const account = requireAccount()
  res.json({ scan: requireScan(Number(req.params.id), account.id) })
})

scansRouter.get('/scans/:id/senders', (req, res) => {
  const account = requireAccount()
  const scan = requireScan(Number(req.params.id), account.id)
  res.json({ senders: getSenders(scan.id) })
})

scansRouter.get('/scans/:id/classifications', (req, res) => {
  const account = requireAccount()
  const scan = requireScan(Number(req.params.id), account.id)
  res.json({ classifications: listClassifications(scan.id) })
})

scansRouter.post('/scans/:id/classify', async (req, res) => {
  const account = requireAccount()
  const scan = requireScan(Number(req.params.id), account.id)

  const labels: ClassifyLabelInput[] = listLabels(account.id)
    .filter((l) => l.kind === 'user')
    .map((l) => ({ name: l.name, description: l.description }))
  if (labels.length === 0) {
    throw new HttpError(400, 'Create at least one user label (with a description) before classifying.')
  }

  const senders: ClassifySenderInput[] = getSenders(scan.id).map((s) => ({
    email: s.email,
    displayName: s.displayName,
    messageCount: s.messageCount,
    sampleSubjects: s.sampleSubjects,
  }))

  const model = currentModelName()
  try {
    const results = await classifySenders({ labels, senders, model })
    saveClassifications(scan.id, account.id, results, model)
  } catch (error) {
    throw new HttpError(
      502,
      `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  res.json({ classifications: listClassifications(scan.id) })
})

scansRouter.put('/classifications/:id', (req, res) => {
  requireAccount()
  const body = (req.body ?? {}) as { labels?: string[]; status?: ClassificationStatus }
  res.json({ classification: updateClassification(Number(req.params.id), body) })
})

scansRouter.post('/scans/:id/mark', (req, res) => {
  const account = requireAccount()
  const scan = requireScan(Number(req.params.id), account.id)
  const body = (req.body ?? {}) as { status?: ClassificationStatus; ids?: number[] }
  if (!body.status) throw new HttpError(400, 'A status is required.')
  markClassifications(scan.id, body.status, body.ids?.map(Number))
  res.json({ classifications: listClassifications(scan.id) })
})

scansRouter.post('/scans/:id/apply', async (req, res) => {
  const account = requireAccount()
  const scan = requireScan(Number(req.params.id), account.id)
  const body = (req.body ?? {}) as Partial<ApplyOptions>

  const mappings = getAcceptedMappings(scan.id)
  if (mappings.length === 0) {
    throw new HttpError(400, 'No accepted senders to apply. Accept or edit some suggestions first.')
  }

  const options: ApplyOptions = {
    archive: body.archive ?? getBool('filters.archive'),
    markRead: body.markRead ?? getBool('filters.markRead'),
    neverSpam: body.neverSpam ?? getBool('filters.neverSpam'),
    applyToExisting: body.applyToExisting ?? getBool('filters.applyToExisting'),
  }

  const result = await applyRules(account.id, mappings, options)
  res.json({ result, rules: listRules(account.id) })
})

function currentModelName(): string {
  const id = getAiProviderId()
  if (id === 'openai') return getSetting('ai.openai.model') ?? 'openai'
  if (id === 'opencode-go') return getSetting('ai.opencode-go.model') ?? 'opencode-go'
  if (id === 'opencode') return getSetting('ai.opencode.model') ?? 'opencode-default'
  return 'mock'
}
