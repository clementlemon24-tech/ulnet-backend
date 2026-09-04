/**
 * ULNet Database Service
 *
 * LOCAL DEV:  Uses SQLite via better-sqlite3 (zero install needed)
 * PRODUCTION: Uses PostgreSQL via pg
 *
 * Both expose the same `db.query(sql, params)` API so no other
 * file needs to change.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USE_SQLITE = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.startsWith('sqlite');

// ─── Singleton ────────────────────────────────────────────────────────────────

let _instance = null;

function getInstance() {
  if (_instance) return _instance;
  _instance = USE_SQLITE ? createSQLiteDB() : createPGDB();
  return _instance;
}

// ─── SQLite (local dev) ───────────────────────────────────────────────────────

function createSQLiteDB() {
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', '..', 'ulnet_local.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  bootstrapSQLite(sqlite);
  console.log(`[ULNet DB] ✅ SQLite ready → ${dbPath}`);

  return {
    query: (sql, params = []) => {
      const normalised = normaliseSql(sql);
      try {
        if (/^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(normalised)) {
          const stmt = sqlite.prepare(normalised);
          const info = stmt.run(...params);
          return Promise.resolve({ rows: [], rowCount: info.changes });
        }
        const stmt = sqlite.prepare(normalised);
        const rows = stmt.all(...params);
        return Promise.resolve({ rows });
      } catch (err) {
        if (err.message?.includes('already exists')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.reject(err);
      }
    },
  };
}

// ─── PostgreSQL (production) ──────────────────────────────────────────────────

function createPGDB() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
  pool.on('error', (err) =>
    console.error('[ULNet DB] PostgreSQL pool error:', err.message));
  return pool;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const db = {
  query: (sql, params) => getInstance().query(sql, params),
};

export async function connectDB() {
  const inst = getInstance();
  if (!USE_SQLITE) {
    try {
      await inst.query('SELECT 1');
      console.log('[ULNet DB] ✅ PostgreSQL connected');
    } catch (err) {
      console.error('[ULNet DB] ❌ PostgreSQL failed:', err.message);
      process.exit(1);
    }
  }
}

// ─── SQL normaliser: PostgreSQL → SQLite ──────────────────────────────────────

function normaliseSql(sql) {
  return sql
    .replace(/\$(\d+)/g, '?')                           // $1 → ?
    .replace(/::date|::text|::int|::boolean/gi, '')      // type casts
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/CURRENT_DATE/gi, "date('now')")
    .replace(/INTERVAL\s+'(\d+)\s+days'/gi, (_, n) => `'+${n} days'`)
    .replace(/gen_random_uuid\(\)/gi, "(lower(hex(randomblob(16))))")
    .replace(/ON CONFLICT\s*\(([^)]+)\)\s*DO UPDATE SET/gi,
             'ON CONFLICT($1) DO UPDATE SET')
    .replace(/RETURNING \*/gi, '')
    .replace(/JSONB/gi, 'TEXT')
    .replace(/TIMESTAMPTZ/gi, 'TEXT')
    .replace(/SMALLINT/gi, 'INTEGER')
    .replace(/VARCHAR\(\d+\)/gi, 'TEXT')
    .replace(/\bBOOLEAN\b/gi, 'INTEGER')
    .replace(/\bTRUE\b/gi, '1')
    .replace(/\bFALSE\b/gi, '0')
    // SQLite doesn't support FILTER (WHERE ...) in aggregates — strip it
    .replace(/COUNT\(\*\)\s*FILTER\s*\(WHERE[^)]+\)/gi, 'COUNT(*)')
    // Strip window functions / complex casts that SQLite chokes on
    .replace(/date_trunc\('[^']+',\s*[^)]+\)/gi, "date('now')")
    .replace(/::\w+/g, '');
}

// ─── Schema bootstrap (SQLite only) ──────────────────────────────────────────

function bootstrapSQLite(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'parent',
      fcm_token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      child_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      age INTEGER NOT NULL,
      avatar TEXT DEFAULT '👦',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      reason TEXT,
      url TEXT,
      platform TEXT,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS daily_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      blocked_total INTEGER NOT NULL DEFAULT 0,
      scams_blocked INTEGER NOT NULL DEFAULT 0,
      explicit_blocked INTEGER NOT NULL DEFAULT 0,
      screen_time_data TEXT DEFAULT '{}',
      raw_summary TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, report_date)
    );
    CREATE TABLE IF NOT EXISTS screen_time (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      child_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      recorded_date TEXT NOT NULL DEFAULT (date('now')),
      UNIQUE (child_id, platform, recorded_date)
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
  `);
}
