// ============================================================
//  Stellar SDK service — Malabar Ledger
//  Wraps all Stellar/Soroban operations for the API layer.
//  Handles: account setup, asset flags, sponsored reserves,
//  trustline authorization, DEX offers, and contract calls.
// ============================================================

import {
  Networks,
  Horizon,
  Keypair,
  Asset,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Contract,
  nativeToScVal,
  xdr,
  rpc,
  scValToNative,
  SorobanRpc,
} from '@stellar/stellar-sdk';

const NETWORK = process.env.STELLAR_NETWORK || 'testnet';
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

const horizonServer = new Horizon.Server(HORIZON_URL);
const rpcServer = new SorobanRpc.Server(RPC_URL);

// Issuer / admin keypair (loaded from env)
function getIssuerKeypair() {
  if (!process.env.ISSUER_SECRET_KEY) {
    throw new Error('ISSUER_SECRET_KEY not set in environment');
  }
  return Keypair.fromSecret(process.env.ISSUER_SECRET_KEY);
}

function getOracleKeypair() {
  if (!process.env.ORACLE_SECRET_KEY) {
    throw new Error('ORACLE_SECRET_KEY not set in environment');
  }
  return Keypair.fromSecret(process.env.ORACLE_SECRET_KEY);
}

// ── Account helpers ──────────────────────────────────────────

/**
 * Fund a new testnet account via Friendbot.
 */
export async function fundTestnetAccount(publicKey) {
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`
  );
  if (!response.ok) throw new Error('Friendbot funding failed');
  return response.json();
}

/**
 * Load an account from Horizon (for transaction building).
 */
export async function loadAccount(publicKey) {
  return horizonServer.loadAccount(publicKey);
}

// ── Asset issuance ───────────────────────────────────────────

/**
 * Issue a receivable asset with AUTH_REQUIRED + AUTH_REVOCABLE + CLAWBACK_ENABLED.
 * These flags ensure:
 *   - Only KYC-approved wallets can hold the token (AUTH_REQUIRED)
 *   - Issuer can revoke authorization (AUTH_REVOCABLE)
 *   - Issuer can clawback tokens in fraud cases (CLAWBACK_ENABLED)
 *
 * @param {string} assetCode  e.g. "ML0001"
 * @returns {Asset} the created Stellar asset
 */
export async function issueReceivableAsset(assetCode) {
  const issuerKp = getIssuerKeypair();
  const issuerAccount = await loadAccount(issuerKp.publicKey());

  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.setOptions({
        setFlags:
          // AUTH_REQUIRED (1) | AUTH_REVOCABLE (2) | CLAWBACK_ENABLED (8)
          1 | 2 | 8,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(issuerKp);
  const result = await horizonServer.submitTransaction(tx);
  return {
    asset: new Asset(assetCode, issuerKp.publicKey()),
    txHash: result.hash,
  };
}

// ── KYC / Trustline authorization ────────────────────────────

/**
 * Authorize a wallet to hold a specific receivable asset (post-KYC).
 * This is the Stellar-level enforcement of the KYC gate — without this
 * op, the investor cannot receive or hold the token.
 *
 * @param {string} investorPublicKey
 * @param {Asset}  asset              the receivable asset
 */
export async function authorizeInvestorTrustline(investorPublicKey, asset) {
  const issuerKp = getIssuerKeypair();
  const issuerAccount = await loadAccount(issuerKp.publicKey());

  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.allowTrust({
        trustor: investorPublicKey,
        assetCode: asset.code,
        authorize: true,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(issuerKp);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

// ── Sponsored Reserves ───────────────────────────────────────

/**
 * Create a sponsored trustline transaction for a user so they don't need XLM
 * to participate. The project's issuer account sponsors the reserve.
 * Returns the half-signed transaction XDR for the user to sign and submit.
 *
 * @param {string} beneficiaryPublicKey  exporter or investor being onboarded
 * @param {string} assetCode             the receivable asset code (e.g. "ML0001")
 * @returns {string} base64 transaction XDR
 */
export async function createSponsoredTrustline(beneficiaryPublicKey, assetCode) {
  const issuerKp = getIssuerKeypair();
  const issuerAccount = await loadAccount(issuerKp.publicKey());
  const asset = new Asset(assetCode, issuerKp.publicKey());

  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      // Issuer begins sponsoring future reserves for the beneficiary
      Operation.beginSponsoringFutureReserves({
        sponsoredId: beneficiaryPublicKey,
      })
    )
    .addOperation(
      // Beneficiary creates trustline (reserves paid by issuer)
      Operation.changeTrust({
        asset,
        source: beneficiaryPublicKey,
      })
    )
    .addOperation(
      // Beneficiary ends the sponsorship window
      Operation.endSponsoringFutureReserves({
        source: beneficiaryPublicKey,
      })
    )
    .setTimeout(180)
    .build();

  // Sponsor signs first
  tx.sign(issuerKp);
  return tx.toXDR();
}

// ── DEX ──────────────────────────────────────────────────────

/**
 * Create a sell offer on the Stellar DEX for receivable tokens.
 * This gives investors secondary liquidity — they can exit before maturity.
 *
 * @param {string}  sellerSecret  seller's secret key
 * @param {Asset}   selling       receivable token asset
 * @param {Asset}   buying        USDC or XLM
 * @param {string}  amount        amount of receivable tokens to sell
 * @param {string}  price         price ratio { n: numerator, d: denominator }
 */
export async function createDexOffer(sellerSecret, selling, buying, amount, price) {
  const sellerKp = Keypair.fromSecret(sellerSecret);
  const sellerAccount = await loadAccount(sellerKp.publicKey());

  const tx = new TransactionBuilder(sellerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling,
        buying,
        amount: amount.toString(),
        price,
        offerId: 0, // 0 = create new offer
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(sellerKp);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

// ── Soroban Contract calls ────────────────────────────────────

/**
 * Call a Soroban contract function.
 * Used internally by the API routes to invoke the on-chain contracts.
 */
export async function invokeContract(contractId, method, args, signerSecret) {
  const signerKp = Keypair.fromSecret(signerSecret);
  const account = await rpcServer.getAccount(signerKp.publicKey());

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '10000000', // generous fee for Soroban
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate first to get footprint + auth
  const simResult = await rpcServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(signerKp);

  const sendResult = await rpcServer.sendTransaction(preparedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${JSON.stringify(sendResult)}`);
  }

  // Poll for completion
  let getResult;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await rpcServer.getTransaction(sendResult.hash);
    if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) break;
  }

  if (getResult?.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Contract call failed: ${JSON.stringify(getResult)}`);
  }

  return {
    txHash: sendResult.hash,
    result: getResult.returnValue ? scValToNative(getResult.returnValue) : null,
  };
}

// ── Clawback ─────────────────────────────────────────────────

/**
 * Execute a Stellar-native clawback operation on a receivable token.
 * Reclaims tokens from a specific account back to the issuer.
 */
export async function executeClawback(asset, fromPublicKey, amount) {
  const issuerKp = getIssuerKeypair();
  const issuerAccount = await loadAccount(issuerKp.publicKey());

  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.clawback({
        asset,
        from: fromPublicKey,
        amount: amount.toString(),
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(issuerKp);
  const result = await horizonServer.submitTransaction(tx);
  return result.hash;
}

// ── DEX listing (secondary market) ───────────────────────────

/**
 * Create a ManageSellOffer so a token holder can exit before maturity.
 * Returns the tx hash if ISSUER_SECRET_KEY is set, otherwise throws.
 * In production: return an unsigned XDR for the seller (Freighter) to sign.
 */
export async function createDexListing({ sellerAddress, assetCode, assetIssuer, amount, priceUsdc }) {
  const issuerKp = getIssuerKeypair();
  const issuerAccount = await loadAccount(issuerKp.publicKey());

  const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const sellingAsset = new Asset(assetCode, assetIssuer || issuerKp.publicKey());
  const buyingAsset  = new Asset('USDC', USDC_ISSUER);

  const tx = new TransactionBuilder(issuerAccount, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling: sellingAsset,
        buying:  buyingAsset,
        amount:  amount.toString(),
        price:   priceUsdc.toString(),
        source:  sellerAddress,
      })
    )
    .setTimeout(30)
    .build();

  tx.sign(issuerKp);
  const result = await horizonServer.submitTransaction(tx);
  return { hash: result.hash };
}

export { horizonServer, rpcServer, PASSPHRASE };
