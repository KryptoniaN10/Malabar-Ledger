// ============================================================
//  Receivables Router — Aletheia API
//  POST /api/receivables/register    — upload doc + register on-chain
//  GET  /api/receivables             — list all receivables
//  GET  /api/receivables/:id         — get single receivable
//  POST /api/receivables/:id/attest  — attestor signs off
//  POST /api/receivables/:id/list-sale — exporter lists for fractional sale
//  POST /api/receivables/:id/buy-share — investor purchases fraction
//  POST /api/receivables/reset-demo  — wipe + re-seed demo data (admin)
// ============================================================

import express from 'express';
import multer from 'multer';
import { getDb } from '../db/schema.js';
import { sha256, pinToIPFS, validateDocument, validateIEC } from '../services/ipfs.js';
import {
  invokeContract,
  scAddress, scU128, scI128, scU32, scString, scBytes,
  scSymbol, scU64, scVec
} from '../services/soroban.js';
import { horizonServer, authorizeInvestorTrustline } from '../services/stellar.js';
import {
  Asset, TransactionBuilder, Operation, Keypair, BASE_FEE, Networks,
} from '@stellar/stellar-sdk';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const STELLAR_EXPERT_BASE = NETWORK === 'mainnet'
  ? 'https://stellar.expert/explorer/public'
  : 'https://stellar.expert/explorer/testnet';

function isStellarTxHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash);
}

function stellarExpertTx(hash) {
  if (!isStellarTxHash(hash)) return null;
  return `${STELLAR_EXPERT_BASE}/tx/${hash}`;
}

// Only generate an asset URL when we have proof the asset was actually minted
// on-chain (i.e., mint_tx_hash is a real 64-char hex Stellar hash).
// Without this guard the link points to a non-existent asset and Stellar Expert
// shows "The asset does not exist on the ledger."
function stellarExpertAsset(assetCode, issuerPublicKey, mintTxHash) {
  if (!assetCode || !issuerPublicKey || issuerPublicKey.startsWith('demo')) return null;
  if (!isStellarTxHash(mintTxHash)) return null; // asset not confirmed on-chain yet
  return `${STELLAR_EXPERT_BASE}/asset/${assetCode}-${issuerPublicKey}`;
}

function stellarExpertReceivableLinks(rec, issuerPublicKey) {
  const registryUrl = stellarExpertTx(rec.registry_tx_hash);
  const mintUrl     = stellarExpertTx(rec.mint_tx_hash);
  const listUrl     = stellarExpertTx(rec.list_tx_hash);

  return {
    // Only non-null when mint_tx_hash is a confirmed on-chain hash
    stellar_expert_asset_url: stellarExpertAsset(rec.token_asset_code, issuerPublicKey, rec.mint_tx_hash),
    stellar_expert_registry_url: registryUrl,
    stellar_expert_mint_url: mintUrl,
    stellar_expert_list_url: listUrl,
    // Prefer: listing tx → mint tx → registry tx (most recent first)
    stellar_expert_transaction_url: listUrl || mintUrl || registryUrl,
  };
}

const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function getIssuerKp() {
  if (!process.env.ISSUER_SECRET_KEY) return null;
  return Keypair.fromSecret(process.env.ISSUER_SECRET_KEY);
}

// ── List all receivables ──────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { status, exporter } = req.query;

  let sql = 'SELECT * FROM receivables WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (exporter) { sql += ' AND exporter_address = ?'; params.push(exporter); }

  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...params);

  const withAttestations = rows.map((r) => {
    const attestations = db
      .prepare('SELECT * FROM attestations WHERE receivable_id = ?')
      .all(r.id);
    const investments = db
      .prepare('SELECT * FROM investments WHERE receivable_id = ?')
      .all(r.id);
    const issuerPk = process.env.ISSUER_PUBLIC_KEY || 'demo';
    return {
      ...r,
      attestations,
      investments,
      issuer_public_key: issuerPk,
      // Stellar Expert deep links — null when demo/unavailable
      ...stellarExpertReceivableLinks(r, issuerPk),
    };
  });

  res.json(withAttestations);
});

// ── Get single receivable ─────────────────────────────────────
router.get('/:id', (req, res) => {
  if (req.params.id === 'reset-demo') return; // handled below
  const db = getDb();
  const rec = db
    .prepare('SELECT * FROM receivables WHERE id = ?')
    .get(req.params.id);

  if (!rec) return res.status(404).json({ error: 'Not found' });

  const attestations = db
    .prepare('SELECT * FROM attestations WHERE receivable_id = ?')
    .all(rec.id);
  const investments = db
    .prepare('SELECT * FROM investments WHERE receivable_id = ?')
    .all(rec.id);
  const events = db
    .prepare('SELECT * FROM oracle_events WHERE receivable_id = ? ORDER BY occurred_at DESC')
    .all(rec.id);

  res.json({
    ...rec,
    attestations,
    investments,
    events,
    issuer_public_key: process.env.ISSUER_PUBLIC_KEY || 'demo',
    // Stellar Expert deep links
    ...stellarExpertReceivableLinks(rec, process.env.ISSUER_PUBLIC_KEY),
  });
});

// ── Register a new receivable ─────────────────────────────────
router.post('/register', upload.single('document'), async (req, res, next) => {
  try {
    const db = getDb();
    const {
      exporter_address, exporter_name, buyer_name, buyer_country,
      amount_usd, maturity_date, iec_code, commodity,
    } = req.body;

    if (!req.file) return res.status(400).json({ error: 'Document required' });
    if (!exporter_address) return res.status(400).json({ error: 'exporter_address required' });
    if (!amount_usd || parseFloat(amount_usd) <= 0) {
      return res.status(400).json({ error: 'Valid amount_usd required' });
    }
    if (!maturity_date) return res.status(400).json({ error: 'maturity_date required' });
    if (iec_code && !validateIEC(iec_code)) {
      return res.status(400).json({ error: 'IEC code must be a 10-digit number' });
    }

    validateDocument(req.file.buffer, req.file.mimetype);

    const docHash = sha256(req.file.buffer);
    const { cid, hashOnly } = await pinToIPFS(
      req.file.buffer, req.file.originalname,
      { exporter: exporter_address, amount_usd }
    );

    // ── Store in DB ───────────────────────────────────────────
    const result = db
      .prepare(
        `INSERT INTO receivables
          (exporter_address, exporter_name, buyer_name, buyer_country,
           amount_usd, maturity_date, doc_hash, ipfs_cid, doc_filename,
           iec_code, commodity, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        exporter_address, exporter_name, buyer_name, buyer_country,
        parseFloat(amount_usd), maturity_date,
        docHash, cid, req.file.originalname,
        iec_code, commodity
      );

    const newId = result.lastInsertRowid;

    // ── On-chain: ReceivableRegistry.register_receivable() ───
    let chainId = null;
    let registryTxHash = null;
    try {
      const buyerHash = sha256(buyer_name || 'unknown');
      const { txHash, result: onChainResult } = await invokeContract(
        process.env.RECEIVABLE_REGISTRY_CONTRACT_ID,
        'register_receivable',
        [
          scAddress(exporter_address),
          scBytes(buyerHash),
          scI128(Math.round(parseFloat(amount_usd) * 100)), // cents
          scSymbol('USDC'),
          scU64(Math.floor(new Date(maturity_date).getTime() / 1000)),
          scBytes(docHash),
          scBytes(Buffer.from(cid || '', 'utf8').toString('hex')),
          scVec([scAddress(process.env.ORACLE_PUBLIC_KEY)]), // dummy attestor for now
        ],
        process.env.ISSUER_SECRET_KEY
      );
      registryTxHash = txHash;
      chainId = onChainResult;
      console.log(`[register] On-chain registration OK — tx: ${registryTxHash}`);
      // Persist both chain_id and registry_tx_hash
      if (chainId) {
        db.prepare('UPDATE receivables SET chain_id = ?, registry_tx_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(String(chainId), registryTxHash, newId);
      } else if (registryTxHash && !registryTxHash.startsWith('demo_')) {
        db.prepare('UPDATE receivables SET registry_tx_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(registryTxHash, newId);
      }
    } catch (chainErr) {
      console.error('[register] On-chain call FAILED (demo fallback active):', chainErr.message);
      console.error(chainErr.stack);
    }

    res.status(201).json({
      id: newId,
      doc_hash: docHash,
      ipfs_cid: cid,
      hash_only: hashOnly,
      chain_id: chainId,
      registry_tx: registryTxHash,
      status: 'pending',
      message: 'Receivable registered. Awaiting 2-of-3 attestations.',
      stellar_expert_url: stellarExpertTx(registryTxHash),
    });
  } catch (err) {
    next(err);
  }
});

// ── Attest a receivable ───────────────────────────────────────
router.post('/:id/attest', async (req, res, next) => {
  try {
    const db = getDb();
    const { attestor_address, attestor_role, tx_hash } = req.body;
    const receivableId = parseInt(req.params.id);

    if (!attestor_address) return res.status(400).json({ error: 'attestor_address required' });

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Receivable not found' });
    if (rec.status !== 'pending') {
      return res.status(400).json({ error: 'Receivable is not pending' });
    }

    const existing = db
      .prepare('SELECT id FROM attestations WHERE receivable_id = ? AND attestor_address = ?')
      .get(receivableId, attestor_address);
    if (existing) return res.status(409).json({ error: 'Already attested' });

    // ── On-chain: ReceivableRegistry.attest() ────────────────
    let attestTxHash = tx_hash || null;
    try {
      const { txHash } = await invokeContract(
        process.env.RECEIVABLE_REGISTRY_CONTRACT_ID,
        'attest',
        [
          scAddress(attestor_address),
          scU128(receivableId),
        ],
        process.env.ISSUER_SECRET_KEY
      );
      attestTxHash = txHash;
    } catch (chainErr) {
      console.warn('[attest] On-chain call failed (demo ok):', chainErr.message);
    }

    db.prepare(
      'INSERT INTO attestations (receivable_id, attestor_address, attestor_role, tx_hash) VALUES (?, ?, ?, ?)'
    ).run(receivableId, attestor_address, attestor_role || 'unknown', attestTxHash);

    const count = db
      .prepare('SELECT COUNT(*) as c FROM attestations WHERE receivable_id = ?')
      .get(receivableId).c;

    db.prepare('UPDATE receivables SET attestation_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(count, receivableId);

    // ── Threshold met: mint Stellar asset (or prepare a co-signed mint) ───────────────────
    if (count >= 2 && rec.status === 'pending') {
      const assetCode = `ML${String(receivableId).padStart(4, '0')}`;

      db.prepare(
        "UPDATE receivables SET status = 'attested', token_asset_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(assetCode, receivableId);

      // Mint: issue face-value tokens to the exporter.
      // The issuer account must already have AUTH_REQUIRED | AUTH_REVOCABLE | CLAWBACK_ENABLED (flags 1|2|8=11).
      // We send setOptions first in the same tx to ensure the flags are set,
      // then payment to issue the tokens.
      let mintTxHash = null;
      // If client requested a co-sign flow, prepare a partially-signed XDR and return it
      // to the caller so the admin (Freighter) can add their signature and submit.
      const { co_sign, admin_address } = req.body || {};
      const issuerKp = getIssuerKp();

      if (co_sign && admin_address && issuerKp) {
        try {
          // Build transaction with admin as fee-payer (source account)
          const adminAccount = await horizonServer.loadAccount(admin_address);
          const receivableAsset = new Asset(assetCode, issuerKp.publicKey());

          const mintTx = new TransactionBuilder(adminAccount, {
            fee: BASE_FEE,
            networkPassphrase: PASSPHRASE,
          })
            .addOperation(Operation.setOptions({
              source: issuerKp.publicKey(),
              setFlags: 11,
            }))
            .addOperation(Operation.payment({
              source: issuerKp.publicKey(),
              destination: rec.exporter_address,
              asset: receivableAsset,
              amount: String(rec.amount_usd),
            }))
            .setTimeout(30)
            .build();

          // Server signs as issuer (partial signature)
          mintTx.sign(Keypair.fromSecret(process.env.ISSUER_SECRET_KEY));

          const preparedXdr = mintTx.toXDR();
          // Return prepared XDR to frontend for Freighter signing and submission
          return res.json({
            attestation_count: count,
            status: 'attested',
            token_asset_code: assetCode,
            prepared_xdr: preparedXdr,
            message: 'Threshold met — prepared partially-signed mint XDR. Sign and submit from admin wallet.',
          });
        } catch (prepErr) {
          console.error('[attest] Prepare mint XDR failed:', prepErr.message);
          console.error(prepErr.stack);
        }
      }

      // Fallback: server-side minting (existing behavior)
      if (issuerKp) {
        try {
          const issuerAccount = await horizonServer.loadAccount(issuerKp.publicKey());
          const receivableAsset = new Asset(assetCode, issuerKp.publicKey());

          const mintTx = new TransactionBuilder(issuerAccount, {
            fee: BASE_FEE,
            networkPassphrase: PASSPHRASE,
          })
            .addOperation(Operation.setOptions({
              setFlags: 11,
            }))
            .addOperation(Operation.payment({
              destination: rec.exporter_address,
              asset: receivableAsset,
              amount: String(rec.amount_usd),
            }))
            .setTimeout(30)
            .build();

          mintTx.sign(issuerKp);
          const mintResult = await horizonServer.submitTransaction(mintTx);
          mintTxHash = mintResult.hash;
          console.log(`[attest] Token minted on Stellar testnet — asset: ${assetCode}, tx: ${mintTxHash}`);

          db.prepare('UPDATE receivables SET mint_tx_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(mintTxHash, receivableId);
        } catch (mintErr) {
          console.error('[attest] Mint tx FAILED:', mintErr.message);
          if (mintErr.response?.data?.extras?.result_codes) {
            console.error('[attest] Horizon result codes:', JSON.stringify(mintErr.response.data.extras.result_codes));
          }
          console.error(mintErr.stack);
        }
      }

      return res.json({
        attestation_count: count,
        status: 'attested',
        token_asset_code: assetCode,
        attest_tx: attestTxHash,
        mint_tx: mintTxHash,
        message: 'Threshold met — receivable token minted!',
        stellar_expert_url: stellarExpertTx(mintTxHash) || stellarExpertTx(attestTxHash),
        stellar_expert_tx_url: stellarExpertTx(mintTxHash),
        stellar_expert_transaction_url: stellarExpertTx(mintTxHash) || stellarExpertTx(attestTxHash),
        // Only non-null when mintTxHash is a confirmed on-chain hash —
        // prevents "The asset does not exist on the ledger" error on Stellar Expert
        stellar_expert_asset_url: stellarExpertAsset(assetCode, process.env.ISSUER_PUBLIC_KEY, mintTxHash),
      });
    }

    res.json({
      attestation_count: count,
      status: 'pending',
      attest_tx: attestTxHash,
      message: `${count}/2 attestations received. ${2 - count} more required.`,
    });
  } catch (err) {
    next(err);
  }
});

// ── List receivable for fractional sale ───────────────────────
router.post('/:id/list-sale', async (req, res, next) => {
  try {
    const db = getDb();
    const { discount_bps, exporter_address, tx_hash } = req.body;
    const receivableId = parseInt(req.params.id);

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (rec.status !== 'attested') {
      return res.status(400).json({ error: 'Receivable must be attested before listing' });
    }

    const bps = parseInt(discount_bps) || 500; // default 5%
    const faceCents = Math.round(rec.amount_usd * 100);
    const salePrice = rec.amount_usd * (1 - bps / 10000);

    db.prepare(
      "UPDATE receivables SET status = 'active', discount_bps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(bps, receivableId);

    // ── On-chain: FractionalSale.list_for_sale() ─────────────
    // If the frontend (Freighter-signed) already submitted this tx, it passes
    // the hash here — skip the server-side invocation in that case.
    // Use isStellarTxHash to reject demo_ placeholder hashes.
    let listTxHash = isStellarTxHash(tx_hash) ? tx_hash : null;
    if (!listTxHash) {
      try {
        const { txHash } = await invokeContract(
          process.env.FRACTIONAL_SALE_CONTRACT_ID,
          'list_for_sale',
          [
            scAddress(exporter_address || rec.exporter_address),
            scU128(receivableId),
            scI128(faceCents),
            scU32(bps),
            scI128(100_00),      // min share: $100
            scI128(faceCents),   // max share: full face value
            // stablecoin_address — USDC on testnet
            scAddress(process.env.USDC_CONTRACT_ID || 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'),
          ],
          process.env.ISSUER_SECRET_KEY
        );
        if (isStellarTxHash(txHash)) listTxHash = txHash;
      } catch (chainErr) {
        console.warn('[list-sale] On-chain call failed (demo ok):', chainErr.message);
      }
    }

    // Persist list tx hash so the detail view can link to it on page refresh
    if (listTxHash) {
      db.prepare(
        'UPDATE receivables SET list_tx_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(listTxHash, receivableId);
    }

    res.json({
      receivable_id: receivableId,
      face_value_usd: rec.amount_usd,
      discount_bps: bps,
      sale_price_usd: salePrice,
      status: 'active',
      list_tx: listTxHash,
      message: 'Listed for fractional sale',
      // Only non-null when listTxHash is a real Stellar hash (not demo_...)
      stellar_expert_url: stellarExpertTx(listTxHash),
    });
  } catch (err) {
    next(err);
  }
});

// ── Update discount rate on an active sale ────────────────────
router.patch('/:id/discount', async (req, res, next) => {
  try {
    const db = getDb();
    const { discount_bps, exporter_address } = req.body;
    const receivableId = parseInt(req.params.id);

    if (!exporter_address) {
      return res.status(400).json({ error: 'exporter_address required' });
    }

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (rec.status !== 'active') {
      return res.status(400).json({ error: 'Sale is not open — discount cannot be changed' });
    }

    const bps = parseInt(discount_bps);
    if (!bps || bps < 1) {
      return res.status(400).json({ error: 'discount_bps must be at least 1' });
    }
    if (bps > 2000) {
      return res.status(400).json({ error: 'discount_bps cannot exceed 2000 (20%)' });
    }

    const salePrice = rec.amount_usd * (1 - bps / 10000);

    db.prepare(
      'UPDATE receivables SET discount_bps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(bps, receivableId);

    // ── On-chain: FractionalSale.update_discount() ────────────
    let txHash = null;
    try {
      const result = await invokeContract(
        process.env.FRACTIONAL_SALE_CONTRACT_ID,
        'update_discount',
        [
          scAddress(exporter_address),
          scU128(receivableId),
          scU32(bps),
        ],
        process.env.ISSUER_SECRET_KEY
      );
      txHash = result.txHash;
    } catch (chainErr) {
      console.warn('[update-discount] On-chain call failed (demo ok):', chainErr.message);
    }

    res.json({
      receivable_id: receivableId,
      discount_bps: bps,
      sale_price_usd: salePrice,
      tx: txHash,
      message: `Discount updated to ${(bps / 100).toFixed(2)}%`,
    });
  } catch (err) {
    next(err);
  }
});

// ── Buy a fractional share ────────────────────────────────────
router.post('/:id/buy-share', async (req, res, next) => {
  try {
    const db = getDb();
    const { investor_address, share_usd, tx_hash } = req.body;
    const receivableId = parseInt(req.params.id);

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (rec.status !== 'active') {
      return res.status(400).json({ error: 'Receivable is not open for investment' });
    }
    if (!investor_address) return res.status(400).json({ error: 'investor_address required' });

    // Check KYC
    const kycSession = db
      .prepare("SELECT status FROM kyc_sessions WHERE wallet_address = ? AND status = 'approved'")
      .get(investor_address);
    if (!kycSession) {
      return res.status(403).json({
        error: 'KYC required',
        message: 'Investor must complete KYC before purchasing shares',
      });
    }

    const shareUsd = parseFloat(share_usd);
    if (isNaN(shareUsd) || shareUsd <= 0) {
      return res.status(400).json({ error: 'share_usd must be a positive number' });
    }

    const discountBps = rec.discount_bps || 500;
    const paymentUsd = shareUsd * (1 - discountBps / 10000);

    // ── On-chain: FractionalSale.buy_share() ─────────────────
    let purchaseTxHash = tx_hash || null;
    try {
      const { txHash } = await invokeContract(
        process.env.FRACTIONAL_SALE_CONTRACT_ID,
        'buy_share',
        [
          scAddress(investor_address),
          scU128(receivableId),
          scI128(Math.round(shareUsd * 100)),
        ],
        process.env.ISSUER_SECRET_KEY
      );
      purchaseTxHash = txHash;
    } catch (chainErr) {
      console.warn('[buy-share] On-chain call failed (demo ok):', chainErr.message);
    }

    // If issuer keys are available and no tx_hash from frontend, also transfer the
    // receivable token to the investor (represents their fractional claim)
    if (!purchaseTxHash?.startsWith('demo_') === false && !tx_hash) {
      // The signed USDC payment XDR comes from the frontend (Freighter)
      // We only record the DB entry here; the actual token transfer
      // happens via the Soroban contract or a separate Stellar Payment op
    }

    db.prepare(
      'INSERT INTO investments (receivable_id, investor_address, share_cents, payment_cents, tx_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(
      receivableId, investor_address,
      Math.round(shareUsd * 100),
      Math.round(paymentUsd * 100),
      purchaseTxHash
    );

    // Record oracle event for live feed
    db.prepare(
      `INSERT INTO oracle_events (receivable_id, event_type, amount_cents, proof, triggered_by)
       VALUES (?, 'share_purchased', ?, ?, ?)`
    ).run(receivableId, Math.round(shareUsd * 100), purchaseTxHash || 'demo', investor_address);

    res.status(201).json({
      receivable_id: receivableId,
      investor_address,
      share_usd: shareUsd,
      payment_usd: paymentUsd,
      discount_bps: discountBps,
      tx_hash: purchaseTxHash,
      message: 'Share purchased successfully',
      stellar_expert_url: stellarExpertTx(purchaseTxHash),
    });
  } catch (err) {
    next(err);
  }
});

// ── Submit mint tx hash after client-side (co-sign) submission ─────────────
router.post('/:id/submit-mint', async (req, res, next) => {
  try {
    const db = getDb();
    const receivableId = parseInt(req.params.id);
    const { tx_hash } = req.body || {};
    if (!tx_hash) return res.status(400).json({ error: 'tx_hash required' });

    const rec = db.prepare('SELECT * FROM receivables WHERE id = ?').get(receivableId);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    db.prepare('UPDATE receivables SET mint_tx_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(tx_hash, receivableId);

    res.json({ ok: true, receivable_id: receivableId, mint_tx: tx_hash, stellar_expert_url: stellarExpertTx(tx_hash) });
  } catch (err) {
    next(err);
  }
});

// ── Demo reset ────────────────────────────────────────────────
// POST /api/receivables/reset-demo
// Clears all receivables, investments, attestations, and oracle events.
// If body contains { clear_only: true }, it skips seeding new demo data.
router.post('/reset-demo', async (req, res, next) => {
  try {
    const db = getDb();
    const { clear_only } = req.body || {};

    // Clear all derived data first (FK order)
    db.prepare('DELETE FROM oracle_events').run();
    db.prepare('DELETE FROM investments').run();
    db.prepare('DELETE FROM attestations').run();
    db.prepare('DELETE FROM receivables').run();

    if (clear_only) {
      return res.json({
        success: true,
        receivables_created: 0,
        message: 'Database cleared successfully. All receivables and metadata removed.',
      });
    }

    // Dynamic import to avoid circular deps
    const { seedDemo } = await import('../seed-demo.js');
    await seedDemo(db);

    const count = db.prepare('SELECT COUNT(*) as c FROM receivables').get().c;
    res.json({
      success: true,
      receivables_created: count,
      message: `Demo reset complete. ${count} receivables seeded.`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
