import { Router } from 'express'
import { HttpError, requireAccount } from '../http.ts'
import {
  createLocalLabel,
  listLabels,
  syncLabelsFromGmail,
  updateLabel,
} from '../gmail/labels.ts'
import { getGmail } from '../gmail/oauth.ts'

export const labelsRouter: Router = Router()

labelsRouter.get('/labels', (_req, res) => {
  const account = requireAccount()
  res.json({ labels: listLabels(account.id) })
})

labelsRouter.post('/labels/sync', async (_req, res) => {
  const account = requireAccount()
  const labels = await syncLabelsFromGmail(account.id, getGmail(account.id))
  res.json({ labels })
})

labelsRouter.post('/labels', (req, res) => {
  const account = requireAccount()
  const { name, description } = (req.body ?? {}) as { name?: string; description?: string }
  if (!name || !name.trim()) throw new HttpError(400, 'Label name is required.')
  res.status(201).json({ label: createLocalLabel(account.id, name, description ?? '') })
})

labelsRouter.put('/labels/:id', (req, res) => {
  const account = requireAccount()
  const id = Number(req.params.id)
  const { name, description } = (req.body ?? {}) as { name?: string; description?: string }
  res.json({ label: updateLabel(account.id, id, { name, description }) })
})
