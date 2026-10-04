/**
 * Global throttle for Gmail API requests.
 *
 * Gmail's per-user quota ("Total Query Cost", units per minute) is easy to trip
 * during a scan. Concurrency alone is not enough: many small requests can still
 * burst above the limit. This scheduler spaces request *starts* so the whole
 * process stays under a configurable requests-per-second, and supports a
 * cooldown window after a quota error so all workers back off together.
 */

let minIntervalMs = 1000 / 8
let nextSlot = 0
let cooldownUntil = 0

export function setGmailRequestsPerSecond(rps: number): void {
  const clamped = Math.max(1, Math.min(50, Math.floor(rps) || 8))
  minIntervalMs = 1000 / clamped
}

/** Pause all Gmail requests for `ms` (called when a quota error is seen). */
export function cooldownGmail(ms: number): void {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(0, ms))
}

/** Wait until it is this request's turn, then reserve the next slot. */
export async function acquireGmailSlot(): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot, cooldownUntil)
  nextSlot = slot + minIntervalMs
  const wait = slot - now
  if (wait > 0) await sleep(wait)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
