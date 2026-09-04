/**
 * ULNet Database — Pure JS in-memory store for Render free tier.
 * No native modules needed. Data persists within a session.
 * For production: set DATABASE_URL to a PostgreSQL connection string.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USE_PG = process.env.DATABASE_URL &&
  process.env.DATABASE_URL.startsWith('postgres');

// ─── In-Memory Store ─────────────────────────────────────────────────────────

const store = {
  users: [],
  children: [],
  user_settings: [],
  activity_log: [],
  daily_reports: [],
  screen_time: [],
  refresh_tokens: [],
  password_resets: [],
  subscriptions: [],
};

function memQuery(sql, params = []) {
  const s = sql.trim();
  const sLow = s.toLowerCase();

  // Health check
  if (sLow === 'select 1') return { rows: [{ '?column?': 1 }] };

  // Detect table
  const tMatch = s.match(/(?:FROM|INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
  const tName = tMatch ? tMatch[1].toLowerCase() : null;
  if (tName && !store[tName]) store[tName] = [];
  const table = tName ? store[tName] : [];

  // ── INSERT ────────────────────────────────────────────────────────────────
  if (sLow.startsWith('insert')) {
    const colMatch = s.match(/\(([^)]+)\)\s+VALUES/i);
    if (colMatch) {
      const cols = colMatch[1].split(',').map(c => c.trim().replace(/"/g, ''));
      const row = {};
      cols.forEach((col, i) => { row[col] = params[i] ?? null; });
      table.push(row);
    }
    return { rows: [], rowCount: 1 };
  }

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (sLow.startsWith('update')) {
    // UPDATE table SET col = ? WHERE id_col = ?
    const setMatch = s.match(/SET\s+(.+?)\s+WHERE/i);
    const whereMatch = s.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    if (setMatch && whereMatch && tName) {
      const whereCol = whereMatch[1];
      const whereVal = params[params.length - 1];
      const setPairs = setMatch[1].split(',').map(p => p.trim());
      let pi = 0;
      store[tName] = table.map(row => {
        if (String(row[whereCol]) === String(whereVal)) {
          const updated = { ...row };
          setPairs.forEach(pair => {
            const [col] = pair.split('=').map(x => x.trim());
            updated[col] = params[pi++];
          });
          return updated;
        }
        return row;
      });
    }
    return { rows: [], rowCount: 1 };
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (sLow.startsWith('delete')) {
    const whereMatch = s.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    if (whereMatch && tName) {
      const col = whereMatch[1];
      const val = params[0];
      store[tName] = table.filter(r => String(r[col]) !== String(val));
    }
    return { rows: [], rowCount: 1 };
  }

  // ── SELECT ────────────────────────────────────────────────────────────────
  if (sLow.startsWith('select')) {
    // COUNT(*)
    if (sLow.includes('count(*)')) {
      const cnt = table.length;
      return { rows: [{ count: cnt, 'count(*)': cnt, 'COUNT(*)': cnt }] };
    }

    let results = [...table];

    // Simple WHERE col = ?
    const whereMatches = [...s.matchAll(/(\w+)\s*=\s*\?/gi)];
    whereMatches.forEach((m, i) => {
      const col = m[1];
      const val = params[i];
      if (col && val !== undefined) {
        results = results.filter(r =>
          String(r[col]) === String(val)
        );
      }
    });

    // JOIN: if query has JOIN, try to enrich results
    if (sLow.includes('join')) {
      const joinMatch = s.match(/JOIN\s+(\w+)\s+\w+\s+ON\s+\w+\.(\w+)\s*=\s*\w+\.(\w+)/gi);
      // For now return results as-is — complex joins handled by route logic
    }

    // LIMIT
    const limitMatch = s.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) results = results.slice(0, parseInt(limitMatch[1], 10));

    // OFFSET
    const offsetMatch = s.match(/OFFSET\s+(\d+)/i);
    if (offsetMatch) results = results.slice(parseInt(offsetMatch[1], 10));

    return { rows: results };
  }

  return { rows: [] };
}

// ─── PostgreSQL ───────────────────────────────────────────────────────────────

async function createPGDB() {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
  pool.on('error', err => console.error('[DB] Pool error:', err.message));
  return pool;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db = null;

async function getDB() {
  if (_db) return _db;
  if (USE_PG) {
    _db = await createPGDB();
    console.log('[ULNet DB] ✅ PostgreSQL connected');
  } else {
    _db = { query: (sql, params) => Promise.resolve(memQuery(sql, params)) };
    console.log('[ULNet DB] ✅ In-memory store ready');
  }
  return _db;
}

export const db = {
  query: async (sql, params) => {
    const instance = await getDB();
    return instance.query(sql, params);
  },
};

export async function connectDB() {
  await getDB();
}
