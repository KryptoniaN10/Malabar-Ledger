// ── SQLite schema for off-chain metadata ──────────────────────
//  Stores doc metadata, KYC sessions, and receivable state
//  that doesn't live on-chain (e.g. IPFS CIDs, exporter details)

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Default to ./malabar.db (= /app/malabar.db on Railway) — always writable.
// Override with DATABASE_URL=/data/malabar.db if you have a Railway volume mounted at /data.
const DB_PATH = process.env.DATABASE_URL
  ? path.resolve(process.env.DATABASE_URL)
  : path.join(process.cwd(), 'malabar.db');

// Ensure the directory exists (critical for volume mounts like /data)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;

export function getDb() {
  if (!db) throw new Error('DB not initialized — call initDb() first');
  return db;
}

export async function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- ── Receivables ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS receivables (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id            TEXT,           -- on-chain receivable ID (returned by contract)
      exporter_address    TEXT NOT NULL,
      exporter_name       TEXT,
      buyer_name          TEXT,
      buyer_country       TEXT,
      amount_usd          REAL NOT NULL,
      currency            TEXT DEFAULT 'USDC',
      maturity_date       TEXT NOT NULL,
      doc_hash            TEXT NOT NULL,  -- SHA-256 hex of uploaded doc
      ipfs_cid            TEXT,           -- Pinata/IPFS CID
      doc_filename        TEXT,
      iec_code            TEXT,           -- IEC (Importer-Exporter Code) of exporter
      commodity           TEXT,           -- e.g. "Black Pepper", "Frozen Shrimp"
      status              TEXT DEFAULT 'pending',  -- pending|attested|active|settled|clawback
      attestation_count   INTEGER DEFAULT 0,
      discount_bps        INTEGER,
      token_asset_code    TEXT,
      registry_tx_hash    TEXT,   -- Stellar tx hash of on-chain registration
      mint_tx_hash        TEXT,   -- Stellar tx hash of token mint (Horizon)
      list_tx_hash        TEXT,   -- Stellar tx hash of list_for_sale invocation
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Attestations ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS attestations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      receivable_id   INTEGER NOT NULL REFERENCES receivables(id),
      attestor_address TEXT NOT NULL,
      attestor_role   TEXT,   -- 'logistics', 'export_council', 'nbfc'
      tx_hash         TEXT,
      attested_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(receivable_id, attestor_address)
    );

    -- ── KYC Sessions ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS kyc_sessions (
      id              TEXT PRIMARY KEY,   -- UUID
      wallet_address  TEXT NOT NULL UNIQUE,
      status          TEXT DEFAULT 'pending',  -- pending|approved|rejected
      name            TEXT,
      email           TEXT,
      pan_number      TEXT,
      started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME
    );

    -- ── Investments ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS investments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      receivable_id   INTEGER NOT NULL REFERENCES receivables(id),
      investor_address TEXT NOT NULL,
      share_cents     INTEGER NOT NULL,
      payment_cents   INTEGER NOT NULL,   -- actual stablecoin paid (discounted)
      tx_hash         TEXT,
      invested_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Oracle Events ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS oracle_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      receivable_id   INTEGER NOT NULL REFERENCES receivables(id),
      event_type      TEXT,   -- 'payment_confirmed' | 'distributed' | 'clawback'
      amount_cents    INTEGER,
      proof           TEXT,
      tx_hash         TEXT,
      triggered_by    TEXT,
      occurred_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Users (credential-based auth) ────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT NOT NULL UNIQUE,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL CHECK(role IN ('investor', 'exporter', 'admin')),
      full_name       TEXT,
      company_name    TEXT,
      wallet_address  TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── Migration: add new columns to existing DBs ──────────────────
  // ALTER TABLE ADD COLUMN is idempotent-safe with try/catch.
  const migrations = [
    "ALTER TABLE receivables ADD COLUMN registry_tx_hash TEXT",
    "ALTER TABLE receivables ADD COLUMN mint_tx_hash TEXT",
    "ALTER TABLE receivables ADD COLUMN list_tx_hash TEXT",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists — safe to ignore */ }
  }

  // ── Auto-seed on cold start ───────────────────────────────────
  // If the receivables table is empty (fresh DB / after redeploy),
  // populate it with demo data so the app works out of the box.
  const count = db.prepare('SELECT COUNT(*) as c FROM receivables').get().c;
  if (count === 0) {
    console.log('[DB] Empty database detected — seeding demo data...');
    try {
      const { seedDemo } = await import('../seed-demo.js');
      seedDemo(db);
      const seeded = db.prepare('SELECT COUNT(*) as c FROM receivables').get().c;
      console.log(`[DB] Demo seed complete — ${seeded} receivables inserted.`);
    } catch (seedErr) {
      console.warn('[DB] Auto-seed failed (non-fatal):', seedErr.message);
    }
  }

  console.log('[DB] Schema initialized at', DB_PATH);
}
