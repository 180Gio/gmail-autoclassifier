import { Router } from 'express'
import { WEB_ORIGIN } from '../env.ts'
import { HttpError, requireAccount } from '../http.ts'
import { disconnectAccount, getAuthUrl, handleOAuthCallback } from '../gmail/oauth.ts'
import { isGoogleConfigured } from '../settings.ts'

export const authRouter: Router = Router()

authRouter.get('/auth/google', (_req, res) => {
  if (!isGoogleConfigured()) {
    throw new HttpError(400, 'Configure the Google Client ID and Secret in Settings first.')
  }
  res.redirect(getAuthUrl())
})

authRouter.get('/auth/google/callback', async (req, res) => {
  const error = typeof req.query.error === 'string' ? req.query.error : null
  if (error) {
    res.redirect(`${WEB_ORIGIN}/?authError=${encodeURIComponent(error)}`)
    return
  }
  const code = typeof req.query.code === 'string' ? req.query.code : null
  if (!code) {
    res.redirect(`${WEB_ORIGIN}/?authError=${encodeURIComponent('Missing OAuth code.')}`)
    return
  }
  try {
    const account = await handleOAuthCallback(code)
    res.redirect(`${WEB_ORIGIN}/?connected=${encodeURIComponent(account.email)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.redirect(`${WEB_ORIGIN}/?authError=${encodeURIComponent(message)}`)
  }
})

authRouter.post('/auth/disconnect', (_req, res) => {
  requireAccount()
  disconnectAccount()
  res.json({ ok: true })
})
