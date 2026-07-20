import dotenv from 'dotenv';
dotenv.config();

import { invokeContract, scAddress, scU128, scI128, scString, scBytes, scVec } from './src/services/soroban.js';
import { xdr } from '@stellar/stellar-sdk';
import { createHash } from 'crypto';

function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

function scU64(n) {
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
}

function scSymbol(s) {
  return xdr.ScVal.scvSymbol(Buffer.from(s, 'utf8'));
}

async function main() {
    try {
        const docHash = sha256('dummy_doc'); 
        const buyerHash = sha256('buyer_gmbh');
        const exporter = process.env.DEMO_EXPORTER_PUBLIC_KEY || 'GA7YVROXYM2MUDL7T7PDBZ7PDBZ7PDBZ7PDBZ7PDBZ7PDBZ7PDBZ7PDB';
        const amount_usd_cents = 50000;
        const maturity_date = Math.floor(new Date('2026-12-31').getTime() / 1000);
        const cid = 'Qm123';

        console.log('Contract ID:', process.env.RECEIVABLE_REGISTRY_CONTRACT_ID);

        const { txHash, result: onChainResult } = await invokeContract(
            process.env.RECEIVABLE_REGISTRY_CONTRACT_ID,
            'register_receivable',
            [
              scAddress(exporter),
              scBytes(buyerHash),
              scI128(amount_usd_cents),
              scSymbol('USDC'),
              scU64(maturity_date),
              scBytes(docHash),
              scBytes(Buffer.from(cid, 'utf8').toString('hex')),
              scVec([scAddress(exporter)]), 
            ],
            process.env.ISSUER_SECRET_KEY
          );

        console.log('Success!', { txHash, onChainResult });
    } catch (e) {
        console.error('Error invoking contract:', e);
    }
}

main();
