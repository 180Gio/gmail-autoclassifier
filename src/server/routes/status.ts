import { Router } from 'express'
import type { StatusResponse } from '../../shared/types.ts'
import { all, get } from '../db.ts'
import { getProvider } from '../ai/index.ts'
import { getAccount } from '../gmail/oauth.ts'
import { getAiProviderId, isGoogleConfigured } from '../settings.ts'

export const statusRouter: Router = Router()

statusRouter.get('/status', (_req, res) => {
  const account = getAccount()
  const provider = getProvider()
  const counts = get<{ labels: number; scans: number; rules: number }>(
    `SELECT
       (SELECT COUNT(*) FROM labels WHERE account_id = COALESCE(?, -1)) AS labels,
       (SELECT COUNT(*) FROM scans  WHERE account_id = COALESCE(?, -1)) AS scans,
       (SELECT COUNT(*) FROM rules  WHERE account_id = COALESCE(?, -1) AND status = 'active') AS rules`,
    account?.id ?? null,
    account?.id ?? null,
    account?.id ?? null,
  )
  const response: StatusResponse = {
    connected: Boolean(account),
    account,
    providerId: getAiProviderId(),
    providerLabel: provider.label,
    providerReady: provider.ready,
    googleConfigured: isGoogleConfigured(),
    counts: counts ?? { labels: 0, scans: 0, rules: 0 },
  }
  res.json(response)
})

// Tiny liveness probe; also surfaces whether the DB is reachable.
statusRouter.get('/health', (_req, res) => {
  all('SELECT 1 AS ok')
  res.json({ ok: true })
})
