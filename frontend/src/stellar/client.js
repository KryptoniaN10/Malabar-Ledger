// ============================================================
//  Stellar client — Malabar Ledger Frontend
//  Wraps Stellar SDK operations and provides a simulation layer
//  that mirrors the exact contract API surface. When real
//  contract IDs are deployed, swap the simulation calls for
//  real Soroban invocations — the API surface is identical.
// ============================================================

import { Horizon, Networks, Asset } from '@stellar/stellar-sdk';

const NETWORK = import.meta.env.VITE_STELLAR_NETWORK || 'testnet';
const HORIZON_URL = import.meta.env.VITE_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export const horizonServer = new Horizon.Server(HORIZON_URL);

// ── Freighter wallet integration ──────────────────────────────

export async function connectFreighter() {
  if (typeof window === 'undefined') return null;

  try {
    // Check window.stellar directly (injects early on mobile app built-in browser)
    const hasStellarWindow = !!window.stellar;
    const { isConnected, requestAccess, getPublicKey } = await import('@stellar/freighter-api');

    const connected = await isConnected();
    const connectedVal = typeof connected === 'boolean' ? connected : !!(connected && connected.isConnected);
    const isAvailable = hasStellarWindow || connectedVal;

    if (!isAvailable) {
      console.warn('[Freighter] Neither extension nor mobile app is detected.');
      return null;
    }

    // Try requestAccess (works on both extension and mobile app)
    try {
      const access = await requestAccess();
      if (access && access.address) {
        return access.address;
      }
      if (access && access.error) {
        throw new Error(access.error);
      }
    } catch (e) {
      console.warn('[Freighter] requestAccess failed, trying fallback:', e.message);
    }

    // Try getPublicKey (legacy returns string directly)
    const pubKey = await getPublicKey();
    if (typeof pubKey === 'string') return pubKey;
    if (pubKey && pubKey.publicKey) return pubKey.publicKey;

    // Direct window.stellar fallback
    if (window.stellar && typeof window.stellar.getPublicKey === 'function') {
      return await window.stellar.getPublicKey();
    }

    return null;
  } catch (err) {
    console.warn('[Freighter] Error connecting:', err.message);
    return null;
  }
}

export async function getFreighterPublicKey() {
  try {
    const { getPublicKey, requestAccess } = await import('@stellar/freighter-api');
    const pubKey = await getPublicKey();
    if (typeof pubKey === 'string') return pubKey;
    if (pubKey && pubKey.publicKey) return pubKey.publicKey;

    if (window.stellar && typeof window.stellar.getPublicKey === 'function') {
      return await window.stellar.getPublicKey();
    }

    const access = await requestAccess();
    return access.address || null;
  } catch {
    return null;
  }
}

// ── Sign a USDC payment XDR with Freighter ─────────────────────
// Builds a minimal Stellar transaction representing the USDC payment
// for a receivable share purchase, asks Freighter to sign it,
// then submits to Horizon. Returns { hash } on success.
// The escrow destination is the API issuer (production: a smart contract).
export async function signTransactionWithFreighter({ investorAddress, paymentUsd, receivableId }) {
  const { signTransaction } = await import('@stellar/freighter-api');
  const { TransactionBuilder, BASE_FEE, Networks } = await import('@stellar/stellar-sdk');

  const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS || investorAddress; // fallback to self in demo

  // Load investor account from Horizon
  const account = await horizonServer.loadAccount(investorAddress);
  const usdcAsset = new Asset('USDC', USDC_ISSUER);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
  })
    .addOperation(
      (await import('@stellar/stellar-sdk')).Operation.payment({
        destination: ESCROW_ADDRESS,
        asset: usdcAsset,
        amount: paymentUsd.toFixed(7),
      })
    )
    .addMemo((await import('@stellar/stellar-sdk')).Memo.text(`ML-REC-${receivableId}`))
    .setTimeout(180)
    .build();

  const txXdr = tx.toXDR();

  // Ask Freighter to sign (with direct window.stellar fallback for mobile webview)
  let signed;
  try {
    signed = await signTransaction(txXdr, {
      networkPassphrase: NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
    });
  } catch (freighterApiErr) {
    if (window.stellar && typeof window.stellar.signTransaction === 'function') {
      const networkPassphrase = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
      const signedXdr = await window.stellar.signTransaction(txXdr, {
        network: NETWORK.toUpperCase(),
        networkPassphrase,
      });
      signed = { signedTxXdr: signedXdr };
    } else {
      throw freighterApiErr;
    }
  }

  if (!signed || !signed.signedTxXdr) {
    throw new Error('Signing failed: no transaction signature returned');
  }

  // Submit signed transaction to Horizon
  const { TransactionBuilder: TB } = await import('@stellar/stellar-sdk');
  const signedTx = TB.fromXDR(signed.signedTxXdr, NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);
  const result = await horizonServer.submitTransaction(signedTx);
  return { hash: result.hash };
}

// ── Execute a sponsored trustline transaction ──────────────────
// Calls the API to build a sponsored reserve trustline, signs it
// with Freighter (beneficiary's signature), and submits it.
export async function executeSponsoredTrustline(beneficiaryAddress, assetCode) {
  const { signTransaction } = await import('@stellar/freighter-api');
  const { TransactionBuilder: TB, Networks } = await import('@stellar/stellar-sdk');

  const response = await stellarApi.sponsorTrustline({
    beneficiary_address: beneficiaryAddress,
    asset_code: assetCode,
  });

  if (!response.sponsored || !response.xdr) {
    return false;
  }

  // Ask Freighter to sign (with direct window.stellar fallback for mobile webview)
  let signed;
  try {
    signed = await signTransaction(response.xdr, {
      networkPassphrase: NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
    });
  } catch (freighterApiErr) {
    if (window.stellar && typeof window.stellar.signTransaction === 'function') {
      const networkPassphrase = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
      const signedXdr = await window.stellar.signTransaction(response.xdr, {
        network: NETWORK.toUpperCase(),
        networkPassphrase,
      });
      signed = { signedTxXdr: signedXdr };
    } else {
      throw freighterApiErr;
    }
  }

  if (!signed || !signed.signedTxXdr) {
    throw new Error('Signing failed: no transaction signature returned');
  }

  // Submit to Horizon
  const signedTx = TB.fromXDR(signed.signedTxXdr, NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);
  const result = await horizonServer.submitTransaction(signedTx);
  return { hash: result.hash };
}

// ── Horizon queries ───────────────────────────────────────────

export async function getAccountBalances(publicKey) {
  try {
    const account = await horizonServer.loadAccount(publicKey);
    return account.balances;
  } catch {
    return [];
  }
}

export async function getTransactions(publicKey, limit = 10) {
  try {
    const txs = await horizonServer
      .transactions()
      .forAccount(publicKey)
      .limit(limit)
      .order('desc')
      .call();
    return txs.records;
  } catch {
    return [];
  }
}

// ── API helpers ───────────────────────────────────────────────

async function apiCall(path, method = 'GET', body = null, isFormData = false) {
  const opts = {
    method,
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    body: body
      ? isFormData
        ? body
        : JSON.stringify(body)
      : null,
  };
  const res = await fetch(`${API_URL}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Receivable API ────────────────────────────────────────────

export const receivablesApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return apiCall(`/api/receivables${qs ? `?${qs}` : ''}`);
  },

  get: (id) => apiCall(`/api/receivables/${id}`),

  register: (formData) =>
    apiCall('/api/receivables/register', 'POST', formData, true),

  attest: (id, body) =>
    apiCall(`/api/receivables/${id}/attest`, 'POST', body),

  listSale: (id, body) =>
    apiCall(`/api/receivables/${id}/list-sale`, 'POST', body),

  buyShare: (id, body) =>
    apiCall(`/api/receivables/${id}/buy-share`, 'POST', body),

  resetDemo: (body) =>
    apiCall('/api/receivables/reset-demo', 'POST', body),
};

// ── KYC / Auth API ────────────────────────────────────────────

export const authApi = {
  startKyc: (body) => apiCall('/api/auth/kyc/start', 'POST', body),
  getKycStatus: (sessionId) => apiCall(`/api/auth/kyc/${sessionId}`),
  checkWalletKyc: (address) => apiCall(`/api/auth/wallets/${address}/kyc`),
  approveKyc: (sessionId) => apiCall(`/api/auth/kyc/${sessionId}/approve`, 'POST'),
  rejectKyc: (sessionId, body) => apiCall(`/api/auth/kyc/${sessionId}/reject`, 'POST', body),
  listSessions: () => apiCall('/api/auth/kyc'),
};

// ── Oracle API ────────────────────────────────────────────────

export const oracleApi = {
  confirmPayment: (id, body) =>
    apiCall(`/api/oracle/${id}/confirm-payment`, 'POST', body),
  distribute: (id, body) =>
    apiCall(`/api/oracle/${id}/distribute`, 'POST', body),
  clawback: (id, body) =>
    apiCall(`/api/oracle/${id}/clawback`, 'POST', body),
  events: () => apiCall('/api/oracle/events'),
};

// ── Stellar info API ──────────────────────────────────────────

export const stellarApi = {
  getAccount: (address) => apiCall(`/api/stellar/account/${address}`),
  getOffers:  (address) => apiCall(`/api/stellar/dex/offers/${address}`),
  getOrderbook: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiCall(`/api/stellar/dex/orderbook?${qs}`);
  },
  createDexListing: (body) => apiCall('/api/stellar/dex/list', 'POST', body),
  sponsorTrustline: (body) => apiCall('/api/stellar/sponsor-trustline', 'POST', body),
};

// ── Platform stats API ────────────────────────────────────────
export const platformApi = {
  getStats: () => apiCall('/api/stats'),
};

// ── Utilities ─────────────────────────────────────────────────

/**
 * Format a Stellar public key for display: GABCD...WXYZ
 */
export function formatAddress(address, chars = 4) {
  if (!address) return '';
  return `${address.slice(0, chars + 1)}...${address.slice(-chars)}`;
}

/**
 * Format USD cents to "$X,XXX.XX"
 */
export function formatUsd(cents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Format a receivable's yield: discount_bps → "5.00% discount / X.X% APY"
 */
export function formatYield(discountBps, daysToMaturity) {
  const discount = discountBps / 100;
  const apy = daysToMaturity
    ? ((discountBps / 10000) / (daysToMaturity / 365)) * 100
    : null;
  return {
    discount: `${discount.toFixed(2)}%`,
    apy: apy ? `${apy.toFixed(1)}% APY` : null,
  };
}

/**
 * Days until maturity
 */
export function daysUntil(dateStr) {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.max(0, Math.ceil((target - now) / (1000 * 60 * 60 * 24)));
}

/**
 * Status → badge class mapping
 */
export const STATUS_BADGE = {
  pending:  'badge-pending',
  attested: 'badge-attested',
  active:   'badge-active',
  settled:  'badge-settled',
  settled_pending: 'badge-active',
  clawback: 'badge-clawback',
};

export const STATUS_LABEL = {
  pending:  'Pending',
  attested: 'Attested',
  active:   'For Sale',
  settled_pending: 'Payout Ready',
  settled:  'Settled',
  clawback: 'Clawback',
};
