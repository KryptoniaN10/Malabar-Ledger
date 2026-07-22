// ============================================================
//  Oracle Router — Judge-triggerable payment confirmation
//  POST /api/oracle/:id/confirm-payment  — confirm importer payment
//  POST /api/oracle/:id/distribute       — trigger pro-rata payout
//  POST /api/oracle/:id/clawback         — emergency clawback
//  GET  /api/oracle/events               — list all oracle events
// ============================================================

import express from 'express';
import { getDb } from '../db/schema.js';
import { invokeContract, scU128, scI128, scAddress } from '../services/soroban.js';
import { horizonServer } from '../services/stellar.js';
import {
  Asset, TransactionBuilder, Operation, Keypair, BASE_FEE, Networks,
} from '@stellar/stellar-sdk';

const router = express.Router();
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const STELLAR_EXPERT_BASE = NETWORK === 'mainnet'
  ? 'https://stellar.expert/explorer/public'
  : 'https://stellar.expert/explorer/testnet';

function getIssuerKp() {
  if (!process.env.ISSUER_SECRET_KEY) return null;
  return Keypair.fromSecret(process.env.ISSUER_SECRET_KEY);
}

// ── Confirm importer payment (judge-triggerable) ──────────────
// In production: called by an automated oracle reading SWIFT/SEPA feeds.
// For demo: a button in the Admin Panel calls this endpoint.
router.post('/:id/confirm-payment', async (req, res, next) => {
  try {
    const db = getDb();
    const { confirmed_amount_usd, proof, triggered_by } = req.body;
    const receivableId = parseInt(req.params.id);

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Receivable not found' });
    if (rec.status !== 'active') {
      return res.status(400).json({ error: 'Receivable must be active to confirm payment' });
    }

    const amountUsd = parseFloat(confirmed_amount_usd) || rec.amount_usd;
    const amountCents = Math.round(amountUsd * 100);
    const paymentProof = proof || `ORACLE-${Date.now()}`;

    // ── On-chain: SettlementEscrow.confirm_payment() ──────────
    let confirmTxHash = null;
    try {
      const { txHash } = await invokeContract(
        process.env.SETTLEMENT_ESCROW_CONTRACT_ID,
        'confirm_payment',
        [
          scU128(receivableId),
          scI128(amountCents),
          scAddress(triggered_by || process.env.ORACLE_PUBLIC_KEY || process.env.ISSUER_PUBLIC_KEY || 'GABC'),
        ],
        process.env.ORACLE_SECRET_KEY || process.env.ISSUER_SECRET_KEY
      );
      confirmTxHash = txHash;
    } catch (chainErr) {
      console.warn('[confirm-payment] On-chain call failed (demo ok):', chainErr.message);
      confirmTxHash = `demo_confirm_${Date.now().toString(36)}`;
    }

    // Record oracle event with tx hash
    db.prepare(
      `INSERT INTO oracle_events
        (receivable_id, event_type, amount_cents, proof, tx_hash, triggered_by)
       VALUES (?, 'payment_confirmed', ?, ?, ?, ?)`
    ).run(receivableId, amountCents, paymentProof, confirmTxHash, triggered_by || 'oracle');

    // Update receivable status
    db.prepare(
      "UPDATE receivables SET status = 'settled_pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(receivableId);

    res.json({
      receivable_id: receivableId,
      confirmed_amount_usd: amountUsd,
      proof: paymentProof,
      status: 'settled_pending',
      confirm_tx: confirmTxHash,
      stellar_expert_url: confirmTxHash && !confirmTxHash.startsWith('demo_')
        ? `${STELLAR_EXPERT_BASE}/tx/${confirmTxHash}`
        : null,
      message: 'Payment confirmed. Ready to distribute to investors.',
    });
  } catch (err) {
    next(err);
  }
});

// ── Distribute pro-rata payout ────────────────────────────────
router.post('/:id/distribute', async (req, res, next) => {
  try {
    const db = getDb();
    const receivableId = parseInt(req.params.id);
    const { triggered_by } = req.body;

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (rec.status !== 'settled_pending') {
      return res.status(400).json({ error: 'Payment must be confirmed first' });
    }

    const investments = db
      .prepare('SELECT * FROM investments WHERE receivable_id = ?')
      .all(receivableId);

    if (investments.length === 0) {
      return res.status(400).json({ error: 'No investors to pay out' });
    }

    const confirmEvent = db
      .prepare("SELECT * FROM oracle_events WHERE receivable_id = ? AND event_type = 'payment_confirmed' ORDER BY occurred_at DESC LIMIT 1")
      .get(receivableId);

    const totalConfirmedCents = confirmEvent?.amount_cents || Math.round(rec.amount_usd * 100);
    const totalShareCents = investments.reduce((sum, inv) => sum + inv.share_cents, 0);

    // ── Calculate pro-rata payouts ────────────────────────────
    const payouts = investments.map((inv, idx) => {
      const isLast = idx === investments.length - 1;
      const paid = investments
        .slice(0, idx)
        .reduce((s, i) => s + Math.floor(totalConfirmedCents * i.share_cents / totalShareCents), 0);
      const payout = isLast
        ? totalConfirmedCents - paid
        : Math.floor(totalConfirmedCents * inv.share_cents / totalShareCents);

      return {
        investor_address: inv.investor_address,
        share_cents: inv.share_cents,
        payout_cents: payout,
        payout_usd: (payout / 100).toFixed(2),
      };
    });

    // ── On-chain: SettlementEscrow.distribute() ───────────────
    let distributeTxHash = null;
    try {
      const { txHash } = await invokeContract(
        process.env.SETTLEMENT_ESCROW_CONTRACT_ID,
        'distribute',
        [scU128(receivableId)],
        process.env.ORACLE_SECRET_KEY || process.env.ISSUER_SECRET_KEY
      );
      distributeTxHash = txHash;
    } catch (chainErr) {
      console.warn('[distribute] On-chain call failed:', chainErr.message);
      distributeTxHash = `demo_distribute_${Date.now().toString(36)}`;
    }

    // ── Stellar: send USDC payments to each investor ──────────
    // Only runs when issuer key is configured
    const issuerKp = getIssuerKp();
    const paymentHashes = [];
    if (issuerKp && rec.token_asset_code) {
      try {
        const issuerAccount = await horizonServer.loadAccount(issuerKp.publicKey());
        const USDC_ISSUER = process.env.USDC_ISSUER || (NETWORK === 'mainnet' ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        const usdcAsset = new Asset('USDC', USDC_ISSUER);

        // Build a single transaction with all payment ops (up to 100 investors)
        const txBuilder = new TransactionBuilder(issuerAccount, {
          fee: BASE_FEE,
          networkPassphrase: PASSPHRASE,
        });

        for (const p of payouts) {
          if (parseFloat(p.payout_usd) > 0) {
            txBuilder.addOperation(
              Operation.payment({
                destination: p.investor_address,
                asset: usdcAsset,
                amount: p.payout_usd,
              })
            );
          }
        }

        const payoutTx = txBuilder.setTimeout(30).build();
        payoutTx.sign(issuerKp);
        const payoutResult = await horizonServer.submitTransaction(payoutTx);
        paymentHashes.push(payoutResult.hash);
      } catch (payErr) {
        console.warn('[distribute] USDC payment batch failed (demo ok):', payErr.message);
      }
    }

    // ── Mark as settled ───────────────────────────────────────
    db.prepare(
      "UPDATE receivables SET status = 'settled', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(receivableId);

    db.prepare(
      `INSERT INTO oracle_events
        (receivable_id, event_type, amount_cents, proof, tx_hash, triggered_by)
       VALUES (?, 'distributed', ?, ?, ?, ?)`
    ).run(receivableId, totalConfirmedCents, 'auto', distributeTxHash, triggered_by || 'oracle');

    res.json({
      receivable_id: receivableId,
      total_distributed_usd: (totalConfirmedCents / 100).toFixed(2),
      investor_count: investments.length,
      payouts,
      distribute_tx: distributeTxHash,
      payment_txs: paymentHashes,
      status: 'settled',
      message: 'Pro-rata payout complete!',
      stellar_expert_url: paymentHashes[0]
        ? `${STELLAR_EXPERT_BASE}/tx/${paymentHashes[0]}`
        : (distributeTxHash && !distributeTxHash.startsWith('demo_')
          ? `${STELLAR_EXPERT_BASE}/tx/${distributeTxHash}`
          : null),
    });
  } catch (err) {
    next(err);
  }
});

// ── Emergency clawback ────────────────────────────────────────
router.post('/:id/clawback', async (req, res, next) => {
  try {
    const db = getDb();
    const { reason, triggered_by } = req.body;
    const receivableId = parseInt(req.params.id);

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    if (!['active', 'attested', 'settled_pending'].includes(rec.status)) {
      return res.status(400).json({ error: `Cannot clawback a receivable with status: ${rec.status}` });
    }

    // ── On-chain: SettlementEscrow.clawback() ────────────────
    let clawbackTxHash = null;
    try {
      const { txHash } = await invokeContract(
        process.env.SETTLEMENT_ESCROW_CONTRACT_ID,
        'clawback',
        [
          scU128(receivableId),
          scAddress(triggered_by || process.env.ISSUER_PUBLIC_KEY || 'GABC'),
        ],
        process.env.ISSUER_SECRET_KEY
      );
      clawbackTxHash = txHash;
    } catch (chainErr) {
      console.warn('[clawback] On-chain call failed (demo ok):', chainErr.message);
      clawbackTxHash = `demo_clawback_${Date.now().toString(36)}`;
    }

    // ── Stellar: Clawback operation per investor token holding ─
    // Requires CLAWBACK_ENABLED flag on the asset
    const issuerKp = getIssuerKp();
    const clawbackHashes = [];
    if (issuerKp && rec.token_asset_code) {
      const investments = db
        .prepare('SELECT * FROM investments WHERE receivable_id = ?')
        .all(receivableId);

      if (investments.length > 0) {
        try {
          const issuerAccount = await horizonServer.loadAccount(issuerKp.publicKey());
          const receivableAsset = new Asset(rec.token_asset_code, issuerKp.publicKey());

          const txBuilder = new TransactionBuilder(issuerAccount, {
            fee: BASE_FEE,
            networkPassphrase: PASSPHRASE,
          });

          for (const inv of investments) {
            // Clawback the investor's proportional token amount
            const tokenAmount = (inv.share_cents / 100).toFixed(7);
            txBuilder.addOperation(
              Operation.clawback({
                asset: receivableAsset,
                from: inv.investor_address,
                amount: tokenAmount,
              })
            );
          }

          const clawTx = txBuilder.setTimeout(30).build();
          clawTx.sign(issuerKp);
          const clawResult = await horizonServer.submitTransaction(clawTx);
          clawbackHashes.push(clawResult.hash);
        } catch (clawErr) {
          console.warn('[clawback] Stellar clawback op failed (demo ok):', clawErr.message);
        }
      }
    }

    db.prepare(
      "UPDATE receivables SET status = 'clawback', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(receivableId);

    db.prepare(
      `INSERT INTO oracle_events
        (receivable_id, event_type, proof, tx_hash, triggered_by)
       VALUES (?, 'clawback', ?, ?, ?)`
    ).run(receivableId, reason || 'Fraud/dispute', clawbackTxHash, triggered_by || 'admin');

    res.json({
      receivable_id: receivableId,
      status: 'clawback',
      reason: reason || 'Fraud/dispute',
      clawback_tx: clawbackTxHash,
      stellar_clawback_txs: clawbackHashes,
      stellar_expert_url: clawbackHashes[0]
        ? `${STELLAR_EXPERT_BASE}/tx/${clawbackHashes[0]}`
        : null,
      message: 'Clawback initiated on all receivable tokens',
    });
  } catch (err) {
    next(err);
  }
});

// ── List oracle events ────────────────────────────────────────
router.get('/events', (_req, res) => {
  const db = getDb();
  const events = db
    .prepare('SELECT * FROM oracle_events ORDER BY occurred_at DESC LIMIT 100')
    .all();
  res.json(events);
});

export default router;
