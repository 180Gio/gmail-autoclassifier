import 'dotenv/config'
import { resolve } from 'node:path'

export const PORT = Number(process.env.PORT ?? 8787)
/**
 * Interface the API binds to. Loopback by default so other devices on the LAN
 * cannot use the connected Gmail account. Set HOST=0.0.0.0 to expose it.
 */
export const HOST = process.env.HOST ?? '127.0.0.1'
export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173'
export const DATA_DIR = resolve(process.cwd(), process.env.DATA_DIR ?? './data')

/**
 * Key used to encrypt secrets (API keys, OAuth tokens) at rest and to sign
 * session cookies. Change it in `.env`; changing it invalidates stored secrets.
 */
export const SESSION_SECRET = process.env.SESSION_SECRET ?? 'change-me-in-production'

export const IS_PROD = process.env.NODE_ENV === 'production'
