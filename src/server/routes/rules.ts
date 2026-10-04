import { Router } from 'express'
import { requireAccount } from '../http.ts'
import { deleteRule, listRules } from '../gmail/apply.ts'
import { deleteGmailFilter, listGmailFilters } from '../gmail/filters.ts'

export const rulesRouter: Router = Router()

rulesRouter.get('/rules', (_req, res) => {
  const account = requireAccount()
  res.json({ rules: listRules(account.id) })
})

rulesRouter.delete('/rules/:id', async (req, res) => {
  const account = requireAccount()
  await deleteRule(account.id, Number(req.params.id))
  res.json({ rules: listRules(account.id) })
})

/** Every filter in Gmail, including ones created outside this app. */
rulesRouter.get('/gmail-filters', async (_req, res) => {
  const account = requireAccount()
  res.json({ filters: await listGmailFilters(account.id) })
})

rulesRouter.delete('/gmail-filters/:id', async (req, res) => {
  const account = requireAccount()
  await deleteGmailFilter(account.id, req.params.id)
  res.json({ filters: await listGmailFilters(account.id) })
})
