import { all, get, nowIso, run } from './db.ts'
import { decrypt, encrypt } from './crypto.ts'
import type { AiProviderId, SettingDefinition, SettingType, SettingView } from '../shared/types.ts'

interface SettingDefInternal extends SettingDefinition {
  env?: string
}

/**
 * The single source of truth for every configurable value.
 * Values are resolved with this precedence:
 *   1. value saved from the web UI (SQLite)
 *   2. environment variable (`.env`)
 *   3. literal default
 */
export const SETTING_DEFINITIONS: SettingDefInternal[] = [
  // --- AI provider ---
  {
    key: 'ai.provider',
    env: 'AI_PROVIDER',
    group: 'ai',
    type: 'select',
    label: 'AI provider',
    help: 'Which provider performs the classification.',
    options: ['opencode', 'opencode-go', 'openai', 'mock'],
    default: 'opencode',
  },
  {
    key: 'ai.opencode.baseUrl',
    env: 'OPENCODE_BASE_URL',
    group: 'ai',
    type: 'string',
    label: 'OpenCode server URL',
    help: 'Where your OpenCode server runs. Keep the default for a local `opencode serve`; change it only for a remote or hosted endpoint.',
    default: 'http://localhost:4096',
  },
  {
    key: 'ai.opencode.model',
    env: 'OPENCODE_MODEL',
    group: 'ai',
    type: 'string',
    label: 'OpenCode model',
    help: 'Optional. Format: provider/model (e.g. opencode/big-pickle). Leave empty for the server default.',
  },
  {
    key: 'ai.opencode.token',
    env: 'OPENCODE_TOKEN',
    group: 'ai',
    type: 'secret',
    label: 'API key / Bearer token',
    help: 'Sent as "Authorization: Bearer <token>" to the OpenCode server. Only needed for a remote, shared or hosted OpenCode endpoint that requires authentication.',
  },
  {
    key: 'ai.opencode-go.apiKey',
    env: 'OPENCODE_GO_API_KEY',
    group: 'ai',
    type: 'secret',
    label: 'OpenCode Go API key',
    help: 'From the OpenCode Console (Go subscription). No local OpenCode server needed.',
  },
  {
    key: 'ai.opencode-go.model',
    env: 'OPENCODE_GO_MODEL',
    group: 'ai',
    type: 'string',
    label: 'Model',
    help: 'Model id served on /chat/completions: e.g. deepseek-v4.1-flash, kimi-k3, glm-5.3, deepseek-v4-pro.',
    default: 'deepseek-v4.1-flash',
  },
  {
    key: 'ai.openai.baseUrl',
    env: 'OPENAI_BASE_URL',
    group: 'ai',
    type: 'string',
    label: 'OpenAI-compatible base URL',
    help: 'Works with OpenAI, OpenRouter, Groq, Ollama (/v1), LM Studio and more.',
    default: 'https://api.openai.com/v1',
  },
  {
    key: 'ai.openai.apiKey',
    env: 'OPENAI_API_KEY',
    group: 'ai',
    type: 'secret',
    label: 'API key',
    help: 'Not needed for local servers such as Ollama.',
  },
  {
    key: 'ai.openai.model',
    env: 'OPENAI_MODEL',
    group: 'ai',
    type: 'string',
    label: 'Model',
    default: 'gpt-4o-mini',
  },

  // --- Google OAuth ---
  {
    key: 'google.clientId',
    env: 'GOOGLE_CLIENT_ID',
    group: 'google',
    type: 'string',
    label: 'OAuth Client ID',
  },
  {
    key: 'google.clientSecret',
    env: 'GOOGLE_CLIENT_SECRET',
    group: 'google',
    type: 'secret',
    label: 'OAuth Client Secret',
  },
  {
    key: 'google.redirectUri',
    env: 'GOOGLE_REDIRECT_URI',
    group: 'google',
    type: 'string',
    label: 'Authorized redirect URI',
    help: 'Read-only. Register this exact URI in Google Cloud Console. To use a different one, set GOOGLE_REDIRECT_URI in .env.',
    default: 'http://localhost:5173/api/auth/google/callback',
    readOnly: true,
  },

  // --- Scan ---
  {
    key: 'scan.months',
    env: 'SCAN_MONTHS',
    group: 'scan',
    type: 'number',
    label: 'Default scan window (months)',
    default: '6',
  },
  {
    key: 'scan.maxMessages',
    env: 'SCAN_MAX_MESSAGES',
    group: 'scan',
    type: 'number',
    label: 'Default max messages per scan',
    default: '2000',
  },
  {
    key: 'scan.concurrency',
    env: 'SCAN_CONCURRENCY',
    group: 'scan',
    type: 'number',
    label: 'Parallel Gmail requests',
    help: 'Lower this if you hit Gmail per-user quota errors. Default 4.',
    default: '4',
  },
  {
    key: 'scan.requestsPerSecond',
    env: 'SCAN_REQUESTS_PER_SECOND',
    group: 'scan',
    type: 'number',
    label: 'Gmail requests per second',
    help: 'Global throttle to stay under Gmail per-user quota. Default 8.',
    default: '8',
  },

  // --- Filter actions (defaults proposed when applying) ---
  {
    key: 'filters.archive',
    env: 'FILTERS_ARCHIVE',
    group: 'filters',
    type: 'boolean',
    label: 'Archive classified mail (skip inbox)',
    default: 'false',
  },
  {
    key: 'filters.markRead',
    env: 'FILTERS_MARK_READ',
    group: 'filters',
    type: 'boolean',
    label: 'Mark classified mail as read',
    default: 'false',
  },
  {
    key: 'filters.neverSpam',
    env: 'FILTERS_NEVER_SPAM',
    group: 'filters',
    type: 'boolean',
    label: 'Never send classified mail to spam',
    default: 'true',
  },
  {
    key: 'filters.applyToExisting',
    env: 'FILTERS_APPLY_EXISTING',
    group: 'filters',
    type: 'boolean',
    label: 'Also apply rules to existing mail',
    default: 'false',
  },
  {
    key: 'filters.maxSendersPerFilter',
    env: 'FILTERS_MAX_SENDERS',
    group: 'filters',
    type: 'number',
    label: 'Max senders per filter',
    help: 'Senders are combined into one Gmail filter per label (from: a OR b OR …). Default 50.',
    default: '50',
  },
]

const BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]))

function dbRow(key: string): { value: string | null; is_secret: number } | undefined {
  return get<{ value: string | null; is_secret: number }>(
    'SELECT value, is_secret FROM settings WHERE key = ?',
    key,
  )
}

/** Resolved raw value (decrypted for secrets). */
export function getSetting(key: string): string | null {
  const def = BY_KEY.get(key)
  const row = dbRow(key)
  if (row && row.value !== null && row.value !== '') {
    return def?.type === 'secret' ? decrypt(row.value) : row.value
  }
  if (def?.env && process.env[def.env]) return process.env[def.env] as string
  return def?.default ?? null
}

export function getBool(key: string): boolean {
  return getSetting(key) === 'true'
}

export function getNumber(key: string, fallback: number): number {
  const value = getSetting(key)
  if (value === null) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Public view for the settings UI. Secrets are only reported as present/absent. */
export function getSettingsView(): SettingView[] {
  return SETTING_DEFINITIONS.map((def) => {
    if (def.type === 'secret') {
      const stored = dbRow(def.key)
      const hasValue = Boolean(
        (stored && stored.value) || (def.env && process.env[def.env]),
      )
      return {
        key: def.key,
        group: def.group,
        type: def.type,
        label: def.label,
        help: def.help,
        options: def.options,
        readOnly: def.readOnly,
        value: null,
        hasValue,
      }
    }
    return {
      key: def.key,
      group: def.group,
      type: def.type,
      label: def.label,
      help: def.help,
      options: def.options,
      readOnly: def.readOnly,
      value: getSetting(def.key),
      hasValue: getSetting(def.key) !== null,
    }
  })
}

function coerce(type: SettingType, value: string): string | null {
  switch (type) {
    case 'boolean':
      return value === 'true' || value === 'false' ? value : null
    case 'number':
      return Number.isFinite(Number(value)) ? String(Number(value)) : null
    case 'select':
      return value
    default:
      return value
  }
}

/**
 * Persist a patch of settings. Unknown keys are ignored.
 * For `secret` fields, an empty/undefined value keeps the existing one.
 */
export function saveSettings(patch: Record<string, unknown>): void {
  for (const [key, raw] of Object.entries(patch)) {
    const def = BY_KEY.get(key)
    if (!def) continue
    if (def.type === 'secret') {
      if (raw === null || raw === undefined || raw === '') continue
      run(
        `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 1, updated_at = excluded.updated_at`,
        key,
        encrypt(String(raw)),
        nowIso(),
      )
      continue
    }
    if (def.type === 'select' && def.options && !def.options.includes(String(raw))) continue
    const value = coerce(def.type, String(raw))
    if (value === null) continue
    run(
      `INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 0, updated_at = excluded.updated_at`,
      key,
      value,
      nowIso(),
    )
  }
}

export function getAiProviderId(): AiProviderId {
  const value = getSetting('ai.provider') as AiProviderId | null
  if (value === 'opencode' || value === 'opencode-go' || value === 'openai' || value === 'mock') {
    return value
  }
  return 'opencode'
}

export interface GoogleConfig {
  clientId: string | null
  clientSecret: string | null
  redirectUri: string
}

export function getGoogleConfig(): GoogleConfig {
  return {
    clientId: getSetting('google.clientId'),
    clientSecret: getSetting('google.clientSecret'),
    redirectUri: getSetting('google.redirectUri') ?? 'http://localhost:5173/api/auth/google/callback',
  }
}

export function isGoogleConfigured(): boolean {
  const { clientId, clientSecret } = getGoogleConfig()
  return Boolean(clientId && clientSecret)
}

/** Debug helper: list stored setting keys (no values). */
export function listStoredSettingKeys(): string[] {
  return all<{ key: string }>('SELECT key FROM settings ORDER BY key').map((r) => r.key)
}
