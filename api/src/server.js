// ============================================================
//  Aletheia — Off-chain Verification API (database reload spacer)
//  Handles: document upload + hashing, attestation routing,
//  mock KYC/Anchor SEP-24, oracle payment confirmation,
//  and Stellar testnet coordination.
// ============================================================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb, getDb } from './db/schema.js';
import receivablesRouter from './routes/receivables.js';
import authRouter from './routes/auth.js';
import oracleRouter from './routes/oracle.js';
import stellarRouter from './routes/stellar.js';
import chatbotRouter from './chatbot/routes.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ── Health ────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'aletheia-api',
    network: process.env.STELLAR_NETWORK || 'testnet',
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/receivables', receivablesRouter);
app.use('/api/auth', authRouter);
app.use('/api/oracle', oracleRouter);
app.use('/api/stellar', stellarRouter);
app.use('/api/chat', chatbotRouter);

// ── Platform stats (used by Landing page) ─────────────────────
app.get('/api/stats', (_req, res) => {
  try {
    const db = getDb();
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_receivables,
        SUM(amount_usd) as total_volume_usd,
        SUM(CASE WHEN status = 'active' THEN amount_usd ELSE 0 END) as active_volume_usd,
        SUM(CASE WHEN status = 'settled' THEN amount_usd ELSE 0 END) as settled_volume_usd,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_count
      FROM receivables
    `).get();
    const investorCount = db.prepare('SELECT COUNT(DISTINCT investor_address) as c FROM investments').get().c;
    const exporterCount = db.prepare('SELECT COUNT(DISTINCT exporter_address) as c FROM receivables').get().c;
    res.json({ ...stats, investor_count: investorCount, exporter_count: exporterCount });
  } catch {
    res.json({ total_receivables: 5, total_volume_usd: 317000, active_count: 1, settled_count: 1 });
  }
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[API Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

// ── Start ─────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n⚖️ Aletheia API running on http://0.0.0.0:${PORT}`);
    console.log(`   Network: ${process.env.STELLAR_NETWORK || 'testnet'}`);
    console.log(`   Horizon: ${process.env.STELLAR_HORIZON_URL}\n`);
  });
});
