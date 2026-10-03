import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './env.ts'

let singleton: DatabaseSync | null = null

/** Open (once) and return the local SQLite database. */
export function getDb(): DatabaseSync {
  if (singleton) return singleton
  mkdirSync(DATA_DIR, { recursive: true })
  const db = new DatabaseSync(join(DATA_DIR, 'app.sqlite'))
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrate(db)
  singleton = db
  return db
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      is_secret  INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      google_id     TEXT,
      refresh_token TEXT,
      access_token  TEXT,
      token_expiry  INTEGER,
      scopes        TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      gmail_id       TEXT,
      name           TEXT NOT NULL,
      description    TEXT NOT NULL DEFAULT '',
      kind           TEXT NOT NULL DEFAULT 'user',
      created_by_app INTEGER NOT NULL DEFAULT 0,
      color          TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS scans (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status           TEXT NOT NULL,
      query            TEXT,
      months           INTEGER NOT NULL DEFAULT 6,
      max_messages     INTEGER NOT NULL DEFAULT 2000,
      messages_fetched INTEGER NOT NULL DEFAULT 0,
      senders_found    INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      started_at       TEXT NOT NULL,
      finished_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS senders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id         INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      account_id      INTEGER NOT NULL,
      email           TEXT NOT NULL,
      display_name    TEXT,
      domain          TEXT,
      message_count   INTEGER NOT NULL DEFAULT 0,
      unread_count    INTEGER NOT NULL DEFAULT 0,
      sample_subjects TEXT NOT NULL DEFAULT '[]',
      last_seen       TEXT,
      UNIQUE(scan_id, email)
    );

    CREATE TABLE IF NOT EXISTS classifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id      INTEGER NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      account_id   INTEGER NOT NULL,
      sender_email TEXT NOT NULL,
      labels       TEXT NOT NULL DEFAULT '[]',
      confidence   REAL,
      rationale    TEXT,
      status       TEXT NOT NULL DEFAULT 'suggested',
      source       TEXT NOT NULL DEFAULT 'ai',
      model        TEXT,
      updated_at   TEXT NOT NULL,
      UNIQUE(scan_id, sender_email)
    );

    CREATE TABLE IF NOT EXISTS rules (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      gmail_filter_id TEXT,
      label_names     TEXT NOT NULL DEFAULT '[]',
      sender_email    TEXT,
      domain          TEXT,
      query           TEXT,
      actions         TEXT NOT NULL DEFAULT '{}',
      backfill        INTEGER NOT NULL DEFAULT 0,
      backfill_count  INTEGER,
      status          TEXT NOT NULL DEFAULT 'active',
      error           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_senders_scan ON senders(scan_id);
    CREATE INDEX IF NOT EXISTS idx_classifications_scan ON classifications(scan_id);
    CREATE INDEX IF NOT EXISTS idx_rules_account ON rules(account_id);
  `)
}

export function nowIso(): string {
  return new Date().toISOString()
}

/** Run a statement and return the number of affected rows. */
export function run(sql: string, ...params: SqlValue[]): { changes: number; lastId: number } {
  const result = getDb().prepare(sql).run(...params)
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) }
}

export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined
}

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[]
}

export type SqlValue = string | number | bigint | null | Uint8Array

/** Parse a JSON text column defensively. */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.length === 0) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
