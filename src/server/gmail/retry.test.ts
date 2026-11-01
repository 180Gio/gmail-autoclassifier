import { describe, expect, it } from 'vitest'
import { isAuthError, isQuotaError, isRetryableGmailError, withRetry } from './retry.ts'
import { setGmailRequestsPerSecond } from './scheduler.ts'

// Keep waits tiny in tests.
setGmailRequestsPerSecond(50)

function googleError(status: number, reason?: string, message = 'error'): Error {
  return Object.assign(new Error(message), {
    response: {
      status,
      data: { error: { message, errors: reason ? [{ reason }] : [] } },
    },
  })
}

describe('Gmail error classification', () => {
  it('retries 429 and rate-limit 403', () => {
    expect(isRetryableGmailError(googleError(429))).toBe(true)
    expect(isRetryableGmailError(googleError(403, 'userRateLimitExceeded'))).toBe(true)
    expect(isRetryableGmailError(googleError(403, 'forbidden'))).toBe(false)
    expect(isRetryableGmailError(googleError(404))).toBe(false)
  })

  it('detects quota errors', () => {
    expect(isQuotaError(new Error("Quota exceeded for quota metric 'Total Query Cost'"))).toBe(true)
    expect(isQuotaError(new Error('something else'))).toBe(false)
  })

  it('detects expired/revoked Google authorization', () => {
    expect(isAuthError(Object.assign(new Error('invalid_grant'), { response: { status: 400 } }))).toBe(true)
    expect(isAuthError(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }))).toBe(true)
    expect(isAuthError(new Error('plain error'))).toBe(false)
  })
})

describe('withRetry', () => {
  it('retries transient errors and then succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw googleError(429)
        return 'ok'
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, cooldownMs: 1 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('does not retry non-retryable errors', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw googleError(404)
        },
        { attempts: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
