import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it, vi } from 'vitest'

// Point the DB at a throwaway directory before importing any project module.
const dir = mkdtempSync(join(tmpdir(), 'gac-test-'))
process.env.DATA_DIR = dir
vi.resetModules()

const { get, getDb, run } = await import('../db.ts')
const { cleanupStaleScans } = await import('./scan.ts')

afterAll(() => {
  try {
    getDb().close()
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

it('marks scans left running by a restart as error', () => {
  const now = new Date().toISOString()
  const accountId = run(
    `INSERT INTO accounts (email, created_at, updated_at) VALUES ('test@example.com', ?, ?)`,
    now,
    now,
  ).lastId
  const scanId = run(
    `INSERT INTO scans (account_id, status, mode, months, max_messages, started_at)
     VALUES (?, 'running', 'full', 6, 100, ?)`,
    accountId,
    now,
  ).lastId

  cleanupStaleScans()

  const row = get<{ status: string; error: string }>(
    'SELECT status, error FROM scans WHERE id = ?',
    scanId,
  )
  expect(row?.status).toBe('error')
  expect(row?.error).toMatch(/Interrupted by a server restart/)
})
