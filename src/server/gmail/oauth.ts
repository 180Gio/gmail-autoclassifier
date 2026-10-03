import { google } from 'googleapis'
import type { Account } from '../../shared/types.ts'
import { decrypt, encrypt } from '../crypto.ts'
import { get, nowIso, run } from '../db.ts'
import { getGoogleConfig } from '../settings.ts'

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>
export type Gmail = ReturnType<typeof google.gmail>

/**
 * Scopes requested on connect.
 * - gmail.labels:            read/create labels
 * - gmail.settings.basic:    create/delete Gmail filters
 * - gmail.modify:            read messages + apply labels to existing mail
 *
 * All three are "sensitive" or "restricted" scopes: for personal use keep the
 * OAuth app in Testing mode (or unverified production) — see the README.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.modify',
]

interface AccountRow {
  id: number
  email: string
  refresh_token: string | null
  access_token: string | null
  token_expiry: number | null
  scopes: string | null
  created_at: string
}

export function createOAuthClient(redirectUri?: string): OAuth2Client {
  const config = getGoogleConfig()
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Google OAuth is not configured. Set Client ID and Secret in Settings.')
  }
  return new google.auth.OAuth2(config.clientId, config.clientSecret, redirectUri ?? config.redirectUri)
}

export function getAuthUrl(): string {
  const client = createOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    include_granted_scopes: true,
  })
}

/** Exchange the OAuth code, fetch the account email and persist (encrypted) tokens. */
export async function handleOAuthCallback(code: string): Promise<Account> {
  const client = createOAuthClient()
  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  const gmail = google.gmail({ version: 'v1', auth: client })
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const email = profile.data.emailAddress
  if (!email) throw new Error('Could not read the Gmail address from the authorized account.')

  const now = nowIso()
  run(
    `INSERT INTO accounts (email, refresh_token, access_token, token_expiry, scopes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       refresh_token = COALESCE(excluded.refresh_token, accounts.refresh_token),
       access_token  = excluded.access_token,
       token_expiry  = excluded.token_expiry,
       scopes        = excluded.scopes,
       updated_at    = excluded.updated_at`,
    email,
    tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    tokens.access_token ? encrypt(tokens.access_token) : null,
    tokens.expiry_date ?? null,
    tokens.scope ?? GMAIL_SCOPES.join(' '),
    now,
    now,
  )

  const account = getAccount()
  if (!account) throw new Error('Failed to store the Gmail account.')
  return account
}

function getAccountRow(): AccountRow | undefined {
  return get<AccountRow>('SELECT * FROM accounts ORDER BY id LIMIT 1')
}

export function getAccount(): Account | null {
  const row = getAccountRow()
  if (!row) return null
  return { id: row.id, email: row.email, createdAt: row.created_at }
}

export function disconnectAccount(): void {
  run('DELETE FROM accounts')
}

function persistRefreshedTokens(accountId: number, client: OAuth2Client): void {
  const credentials = client.credentials
  run(
    `UPDATE accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token),
       token_expiry = ?, updated_at = ? WHERE id = ?`,
    credentials.access_token ? encrypt(credentials.access_token) : null,
    credentials.refresh_token ? encrypt(credentials.refresh_token) : null,
    credentials.expiry_date ?? null,
    nowIso(),
    accountId,
  )
}

/** Return an authorized OAuth2 client for an account, with token refresh persistence. */
export function getAuthorizedClient(accountId: number): OAuth2Client {
  const row = get<AccountRow>('SELECT * FROM accounts WHERE id = ?', accountId)
  if (!row) throw new Error('Account not found.')

  const client = createOAuthClient()
  client.setCredentials({
    refresh_token: row.refresh_token ? decrypt(row.refresh_token) : undefined,
    access_token: row.access_token ? decrypt(row.access_token) : undefined,
    expiry_date: row.token_expiry ?? undefined,
  })
  client.on('tokens', () => {
    try {
      persistRefreshedTokens(accountId, client)
    } catch {
      // Non-fatal: the request can still proceed with the in-memory token.
    }
  })
  return client
}

export function getGmail(accountId: number): Gmail {
  return google.gmail({ version: 'v1', auth: getAuthorizedClient(accountId) })
}
