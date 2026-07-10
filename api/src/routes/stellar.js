// ============================================================
//  Stellar Info Router — testnet account info & DEX queries
//  GET  /api/stellar/account/:address     — account balances
//  GET  /api/stellar/dex/offers/:address  — open DEX offers
//  GET  /api/stellar/dex/orderbook        — price levels for an asset pair
//  POST /api/stellar/dex/list             — create ManageSellOffer for secondary market
//  POST /api/stellar/sponsor-trustline    — sponsored reserve for new investor
//  GET  /api/stellar/stream/issuer        — SSE stream of all issuer payments (LiveFeed)
// ============================================================

import express from 'express';
import { horizonServer, createDexListing, createSponsoredTrustline } from '../services/stellar.js';
import { getDb } from '../db/schema.js';

const router = express.Router();

// ── Account info ──────────────────────────────────────────────
router.get('/account/:address', async (req, res, next) => {
  try {
    const account = await horizonServer.loadAccount(req.params.address);
    res.json({
      address: req.params.address,
      sequence: account.sequenceNumber(),
      balances: account.balances,
      thresholds: account.thresholds,
      flags: account.flags,
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'Account not found on testnet' });
    }
    next(err);
  }
});

// ── Open DEX offers for an account ───────────────────────────
router.get('/dex/offers/:address', async (req, res, next) => {
  try {
    const offers = await horizonServer
      .offers()
      .seller(req.params.address)
      .call();
    res.json(offers.records);
  } catch (err) {
    next(err);
  }
});

// ── Orderbook for a receivable asset pair ─────────────────────
router.get('/dex/orderbook', async (req, res, next) => {
  try {
    const { selling_code, selling_issuer, buying_code, buying_issuer } = req.query;
    const orderbook = await horizonServer
      .orderbook(
        { code: selling_code, issuer: selling_issuer },
        { code: buying_code, issuer: buying_issuer }
      )
      .call();
    res.json(orderbook);
  } catch (err) {
    next(err);
  }
});

// ── Create DEX listing (secondary market sell offer) ──────────
// POST /api/stellar/dex/list
// Body: { seller_address, asset_code, asset_issuer, amount, price_usdc }
// Creates a ManageSellOffer so token holders can exit before maturity.
router.post('/dex/list', async (req, res, next) => {
  try {
    const { seller_address, asset_code, asset_issuer, amount, price_usdc } = req.body;

    if (!seller_address || !asset_code || !amount || !price_usdc) {
      return res.status(400).json({ error: 'seller_address, asset_code, amount, price_usdc required' });
    }

    // Log the intent — actual Stellar tx requires seller to sign via Freighter
    // In production: return an unsigned XDR for the frontend to sign and submit
    const db = getDb();

    // Store as a pending DEX event for the live feed
    db.prepare(`
      INSERT INTO oracle_events (receivable_id, event_type, amount_cents, proof, triggered_by)
      SELECT id, 'dex_listed', ?, ?, ?
      FROM receivables WHERE token_asset_code = ? LIMIT 1
    `).run(
      Math.round(parseFloat(amount) * parseFloat(price_usdc) * 100),
      `DEX:OFFER:${asset_code}@${price_usdc}USDC`,
      seller_address,
      asset_code
    );

    // If issuer key is available, create the actual offer
    let txHash = null;
    if (process.env.ISSUER_SECRET_KEY) {
      try {
        const result = await createDexListing({
          sellerAddress: seller_address,
          assetCode: asset_code,
          assetIssuer: asset_issuer || process.env.ISSUER_PUBLIC_KEY,
          amount: amount.toString(),
          priceUsdc: price_usdc.toString(),
        });
        txHash = result.hash;
      } catch (stellarErr) {
        console.warn('[DEX list] Stellar tx failed (demo mode):', stellarErr.message);
      }
    }

    res.json({
      success: true,
      asset_code,
      amount,
      price_usdc,
      tx_hash: txHash,
      message: txHash
        ? `DEX offer created on Stellar testnet. Tx: ${txHash}`
        : 'DEX listing recorded (demo mode — deploy contracts for live offer)',
      stellar_expert_url: txHash
        ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── Sponsored trustline creation ──────────────────────────────
// POST /api/stellar/sponsor-trustline
// Body: { beneficiary_address, asset_code }
// Creates a BeginSponsoringFutureReserves tx so investors don't need XLM
router.post('/sponsor-trustline', async (req, res, next) => {
  try {
    const { beneficiary_address, asset_code } = req.body;
    if (!beneficiary_address || !asset_code) {
      return res.status(400).json({ error: 'beneficiary_address and asset_code required' });
    }

    if (!process.env.ISSUER_SECRET_KEY) {
      return res.json({
        success: true,
        sponsored: false,
        message: 'Demo mode: no ISSUER_SECRET_KEY — trustline sponsorship skipped. Add keys to enable.',
      });
    }

    const xdr = await createSponsoredTrustline(
      beneficiary_address,
      asset_code
    );

    res.json({
      success: true,
      sponsored: true,
      xdr,
      message: `Sponsorship transaction built. Beneficiary must sign XDR via wallet.`,
    });
  } catch (err) {
    next(err);
  }
});

// ── Horizon SSE stream for issuer account ────────────────────
// GET /api/stellar/stream/issuer
// Streams all payments to/from the issuer address in real-time.
// The frontend LiveFeed subscribes to this instead of polling.
router.get('/stream/issuer', (req, res) => {
  const issuerAddress = process.env.ISSUER_PUBLIC_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send a heartbeat immediately so the client knows connection is alive
  res.write(`data: ${JSON.stringify({ type: 'connected', network: 'testnet', issuer: issuerAddress || 'demo' })}\n\n`);

  if (!issuerAddress) {
    // Demo mode: no issuer configured — send simulated events every 8s
    const interval = setInterval(() => {
      const demoEvents = [
        { type: 'heartbeat', message: 'Demo mode — configure ISSUER_PUBLIC_KEY for live stream' },
      ];
      res.write(`data: ${JSON.stringify(demoEvents[0])}\n\n`);
    }, 8000);
    req.on('close', () => clearInterval(interval));
    return;
  }

  // Real Horizon stream
  let closeStream;
  try {
    closeStream = horizonServer
      .payments()
      .forAccount(issuerAddress)
      .cursor('now')
      .stream({
        onmessage: (payment) => {
          res.write(`data: ${JSON.stringify({
            type: 'payment',
            id: payment.id,
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
            asset_code: payment.asset_code || 'XLM',
            created_at: payment.created_at,
          })}\n\n`);
        },
        onerror: (err) => {
          console.error('[SSE stream error]', err.message);
          res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        },
      });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }

  req.on('close', () => {
    if (closeStream) closeStream();
  });
});

// ── Legacy per-account payment stream ────────────────────────
router.get('/stream/payments/:address', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const closeStream = horizonServer
    .payments()
    .forAccount(req.params.address)
    .cursor('now')
    .stream({
      onmessage: (payment) => {
        res.write(`data: ${JSON.stringify(payment)}\n\n`);
      },
      onerror: (err) => {
        console.error('[Stream error]', err.message);
      },
    });

  req.on('close', () => {
    closeStream();
  });
});

export default router;
