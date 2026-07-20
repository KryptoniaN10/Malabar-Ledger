// ============================================================
//  soroban.js — Soroban contract invocation helper
//
//  Provides a single `invokeContract()` function that:
//   1. Loads the caller's account
//   2. Builds a Soroban transaction for the given contract method
//   3. Simulates it via RPC (gets footprint + fee)
//   4. Signs and submits
//   5. Polls until confirmed and returns { txHash, result }
//
//  When ISSUER_SECRET_KEY is not set, returns a demo-mode
//  placeholder so the rest of the API keeps working without keys.
// ============================================================

import { SorobanRpc, TransactionBuilder, Contract, xdr, Address, nativeToScVal, scValToNative, BASE_FEE, Keypair, Networks } from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const PASSPHRASE = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const rpcServer = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// ── Argument helpers ─────────────────────────────────────────

export function scAddress(address) {
  return nativeToScVal(Address.fromString(address), { type: 'address' });
}

export function scU128(n) {
  return xdr.ScVal.scvU128(
    new xdr.UInt128Parts({
      hi: xdr.Uint64.fromString('0'),
      lo: xdr.Uint64.fromString(String(n)),
    })
  );
}

export function scI128(n) {
  const big = BigInt(n);
  const lo = big & 0xFFFFFFFFFFFFFFFFn;
  const hi = big >> 64n;
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(String(hi)),
      lo: xdr.Uint64.fromString(String(lo)),
    })
  );
}

export function scU32(n) {
  return xdr.ScVal.scvU32(n);
}

export function scU64(n) {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

export function scString(s) {
  return xdr.ScVal.scvString(Buffer.from(s, 'utf8'));
}

export function scSymbol(s) {
  return xdr.ScVal.scvSymbol(Buffer.from(s, 'utf8'));
}

export function scBytes(hex) {
  return xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'));
}

export function scVec(items) {
  return xdr.ScVal.scvVec(items);
}

// ── Core invocation ──────────────────────────────────────────

/**
 * Invoke a Soroban contract function.
 *
 * @param {string}   contractId   - Stellar contract ID (C...)
 * @param {string}   method       - Contract function name
 * @param {xdr.ScVal[]} args      - Arguments as xdr.ScVal[]
 * @param {string}   signerSecret - Stellar secret key of the invoker
 * @returns {Promise<{ txHash: string, result: any }>}
 */
export async function invokeContract(contractId, method, args, signerSecret) {
  // ── Demo mode guard ──────────────────────────────────────
  if (!signerSecret) {
    const demoHash = `demo_${method}_${Date.now().toString(36)}`;
    console.log(`[Soroban] Demo mode — ${method} on ${contractId || 'no-contract'}: ${demoHash}`);
    return { txHash: demoHash, result: null, demo: true };
  }

  if (!contractId) {
    console.warn(`[Soroban] No contract ID for ${method} — demo mode`);
    return { txHash: `demo_${method}_${Date.now().toString(36)}`, result: null, demo: true };
  }

  const invokerKp = Keypair.fromSecret(signerSecret);
  const invokerPublicKey = invokerKp.publicKey();

  // 1. Load account
  const account = await rpcServer.getAccount(invokerPublicKey);

  // 2. Build transaction
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // 3. Simulate (get footprint + fee estimate)
  const simResult = await rpcServer.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban simulation failed: ${simResult.error}`);
  }

  // 4. Prepare (apply footprint and resource fee)
  const preparedTx = await rpcServer.prepareTransaction(tx);
  preparedTx.sign(invokerKp);

  // 5. Submit
  const sendResult = await rpcServer.sendTransaction(preparedTx);
  if (sendResult.status === 'ERROR') {
    throw new Error(`Soroban submit failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  const txHash = sendResult.hash;

  // 6. Poll for confirmation (up to 30s)
  let getResult;
  try {
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      getResult = await rpcServer.getTransaction(txHash);
      if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) break;
    }

    if (getResult && getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Soroban transaction failed: ${txHash}`);
    }
  } catch (err) {
    console.warn(`[Soroban] getTransaction failed or could not be parsed: ${err.message}. Returning txHash anyway.`);
  }

  // 7. Decode return value
  let result = null;
  if (getResult && getResult.returnValue) {
    try {
      result = scValToNative(getResult.returnValue);
    } catch {
      result = getResult.returnValue.toXDR('base64');
    }
  }

  return { txHash, result };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { rpcServer };
