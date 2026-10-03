import { Router } from 'express'
import { requireAccount } from '../http.ts'
import { deleteRule, listRules } from '../gmail/apply.ts'

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
