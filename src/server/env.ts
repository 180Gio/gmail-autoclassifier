import 'dotenv/config'
import { resolve } from 'node:path'

export const PORT = Number(process.env.PORT ?? 8787)
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
export const DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR ?? './data')

/**
 * Key used to encrypt secrets (API keys, OAuth tokens) at rest and to sign
 * session cookies. Change it in `.env`; changing it invalidates stored secrets.
 */
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-me-in-production'

export const IS_PROD = process.env.NODE_ENV === 'production'
