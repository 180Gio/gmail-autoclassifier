/**
 * Retry helper for Gmail API calls.
 *
 * Gmail enforces per-user quotas ("Total Query Cost", units per minute per
 * user). Bursts of `messages.get` during a scan can trip them. Transient 429 /
 * 403 rate-limit / 5xx responses are retried with exponential backoff, honoring
 * a `Retry-After` header when present.
 */

import { acquireGmailSlot, cooldownGmail } from './scheduler.ts'

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /** How long all Gmail requests pause after a quota error. Default 60s. */
  cooldownMs?: number
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6
  const baseDelay = options.baseDelayMs ?? 1500
  const maxDelay = options.maxDelayMs ?? 45000

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await acquireGmailSlot()
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (!isRetryableGmailError(error) || attempt === attempts) throw error

      // A quota error means the whole process must slow down, not just this call.
      if (isQuotaError(error)) cooldownGmail(options.cooldownMs ?? 60000)

      const hinted = retryAfterMs(error)
      const exponential = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1))
      const jittered = Math.round(exponential * (0.5 + Math.random() * 0.5))
      const delay = Math.min(maxDelay, hinted ?? jittered)

      options.onRetry?.(attempt, delay, error)
      await sleep(delay)
    }
  }
  throw lastError
}

export function isRetryableGmailError(error: unknown): boolean {
  const err = error as {
    code?: number | string
    status?: number
    response?: { status?: number; data?: unknown }
    message?: string
  }
  const status = Number(err?.response?.status ?? err?.status ?? err?.code)

  if (status === 429) return true
  if (status === 403) {
    const data = err?.response?.data as
      | { error?: { message?: string; errors?: Array<{ reason?: string }> } }
      | undefined
    const reasons = data?.error?.errors?.map((e) => e.reason ?? '') ?? []
    const message = `${data?.error?.message ?? ''} ${err?.message ?? ''}`
    return (
      reasons.some((r) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(r)) ||
      /quota|rate limit/i.test(message)
    )
  }
  // Transient server-side errors.
  if (status === 500 || status === 502 || status === 503 || status === 504) return true
  return false
}

function retryAfterMs(error: unknown): number | null {
  const headers = (error as { response?: { headers?: unknown } })?.response?.headers
  if (!headers) return null

  let value: string | null | undefined
  const maybeGet = (headers as { get?: (name: string) => string | null }).get
  if (typeof maybeGet === 'function') {
    value = maybeGet.call(headers, 'retry-after')
  } else if (typeof headers === 'object') {
    value = (headers as Record<string, string>)['retry-after']
  }
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

export function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /quota|rate limit|userRateLimitExceeded/i.test(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
