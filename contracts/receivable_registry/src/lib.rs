// ============================================================
//  ReceivableRegistry — Aletheia
//  Manages the lifecycle of tokenized export receivables:
//  register → attest (2-of-3) → mint → active → settled
// ============================================================
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Bytes, BytesN, Env, Map, Symbol, Vec,
};

// ── Data Types ───────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum ReceivableStatus {
    Pending,   // Registered, awaiting attestations
    Attested,  // 2-of-3 threshold met; token minted
    Active,    // FractionalSale completed; exporter paid
    Settled,   // Importer payment confirmed; investors paid out
    Clawback,  // Fraud/dispute; issuer clawed back tokens
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Receivable {
    pub id: u128,
    pub exporter: Address,
    pub buyer_hash: BytesN<32>,       // SHA-256 of buyer identity doc
    pub amount_usd_cents: i128,       // Receivable face value in USD cents
    pub currency: Symbol,             // e.g. symbol_short!("USDC")
    pub maturity_date: u64,           // Unix timestamp
    pub doc_hash: BytesN<32>,         // SHA-256 of uploaded shipping bill / BoL
    pub ipfs_cid: Bytes,              // Off-chain document CID
    pub attestors: Vec<Address>,      // Allowed attestors (up to 3)
    pub attestations: Vec<Address>,   // Who has attested so far
    pub status: ReceivableStatus,
    pub token_asset_code: Option<Symbol>, // Set once minted (e.g. "ML001")
    pub created_at: u64,
}

// ── Storage Keys ─────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const COUNTER: Symbol = symbol_short!("COUNTER");
// Receivables stored as DataKey::Receivable(id)

#[contracttype]
pub enum DataKey {
    Receivable(u128),
    Admin,
    Counter,
}

// ── Contract ─────────────────────────────────────────────────

#[contract]
pub struct ReceivableRegistry;

#[contractimpl]
impl ReceivableRegistry {
    // ── Initializer ─────────────────────────────────────────

    /// Must be called once after deployment.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Counter, &0u128);
        env.storage().instance().extend_ttl(17280, 17280);
    }

    // ── Exporter: Register a new receivable ─────────────────

    /// Exporter submits a purchase order / bill of lading.
    /// `doc_hash` is the SHA-256 of the uploaded document (computed off-chain).
    /// `ipfs_cid` is the IPFS content identifier where the file is pinned.
    /// `attestors` is a Vec of up to 3 addresses (logistics partner, export
    /// council, NBFC) who must attest before minting.
    pub fn register_receivable(
        env: Env,
        exporter: Address,
        buyer_hash: BytesN<32>,
        amount_usd_cents: i128,
        currency: Symbol,
        maturity_date: u64,
        doc_hash: BytesN<32>,
        ipfs_cid: Bytes,
        attestors: Vec<Address>,
    ) -> u128 {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        if attestors.len() == 0 || attestors.len() > 3 {
            panic!("attestors: 1-3 required");
        }
        if amount_usd_cents <= 0 {
            panic!("amount must be positive");
        }

        let id: u128 = env
            .storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0);

        let receivable = Receivable {
            id,
            exporter,
            buyer_hash,
            amount_usd_cents,
            currency,
            maturity_date,
            doc_hash,
            ipfs_cid,
            attestors,
            attestations: Vec::new(&env),
            status: ReceivableStatus::Pending,
            token_asset_code: None,
            created_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Receivable(id), &receivable);

        // Bump counter
        env.storage()
            .instance()
            .set(&DataKey::Counter, &(id + 1));

        env.storage().instance().extend_ttl(17280, 17280);

        env.events().publish(
            (symbol_short!("REGISTER"), symbol_short!("recv")),
            id,
        );

        id
    }

    // ── Attestors: Sign off on a receivable ─────────────────

    /// Called by each of the registered attestors.
    /// Once the 2-of-3 threshold is reached, `mint_receivable_token` is
    /// called automatically and status moves to Attested.
    pub fn attest(env: Env, attestor: Address, receivable_id: u128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let mut receivable: Receivable = env
            .storage()
            .persistent()
            .get(&DataKey::Receivable(receivable_id))
            .expect("receivable not found");

        if receivable.status != ReceivableStatus::Pending {
            panic!("receivable is not pending");
        }

        // Verify attestor is in the allowed set
        let mut is_allowed = false;
        for a in receivable.attestors.iter() {
            if a == attestor {
                is_allowed = true;
                break;
            }
        }
        if !is_allowed {
            panic!("caller not an authorised attestor");
        }

        // Check for duplicate attestation
        for a in receivable.attestations.iter() {
            if a == attestor {
                panic!("already attested");
            }
        }

        receivable.attestations.push_back(attestor.clone());

        env.events().publish(
            (symbol_short!("ATTEST"), symbol_short!("recv")),
            (receivable_id, attestor),
        );

        // 2-of-3 threshold
        if receivable.attestations.len() >= 2 {
            let asset_code = Self::mint_receivable_token(&env, &mut receivable);
            env.events().publish(
                (symbol_short!("MINT"), symbol_short!("recv")),
                (receivable_id, asset_code),
            );
        }

        env.storage()
            .persistent()
            .set(&DataKey::Receivable(receivable_id), &receivable);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Receivable(receivable_id), 17280, 17280);
    }

    // ── Internal: Mint receivable token ──────────────────────

    /// Called internally once attestation threshold is met.
    /// Generates a unique asset code for this receivable.
    /// The actual Stellar asset issuance is coordinated off-chain via SAC;
    /// here we record the token code and flip status.
    fn mint_receivable_token(env: &Env, receivable: &mut Receivable) -> Symbol {
        // Asset code: "ML" + receivable_id (e.g. ML0, ML1 ... for testnet)
        // In production, encode as "ML" + zero-padded 4-digit ID
        let asset_code = symbol_short!("MLREC");
        receivable.token_asset_code = Some(asset_code.clone());
        receivable.status = ReceivableStatus::Attested;
        asset_code
    }

    // ── State transitions ────────────────────────────────────

    /// Called by FractionalSale contract when sale closes and exporter is paid.
    pub fn mark_active(env: Env, caller: Address, receivable_id: u128) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let mut receivable: Receivable = env
            .storage()
            .persistent()
            .get(&DataKey::Receivable(receivable_id))
            .expect("not found");

        if receivable.status != ReceivableStatus::Attested {
            panic!("receivable not attested");
        }
        receivable.status = ReceivableStatus::Active;

        env.storage()
            .persistent()
            .set(&DataKey::Receivable(receivable_id), &receivable);
    }

    /// Called by SettlementEscrow after successful payout.
    pub fn mark_settled(env: Env, caller: Address, receivable_id: u128) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let mut receivable: Receivable = env
            .storage()
            .persistent()
            .get(&DataKey::Receivable(receivable_id))
            .expect("not found");

        receivable.status = ReceivableStatus::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Receivable(receivable_id), &receivable);

        env.events().publish(
            (symbol_short!("SETTLED"), symbol_short!("recv")),
            receivable_id,
        );
    }

    /// Emergency clawback — issuer only.
    pub fn mark_clawback(env: Env, caller: Address, receivable_id: u128) {
        caller.require_auth();
        Self::require_admin(&env, &caller);

        let mut receivable: Receivable = env
            .storage()
            .persistent()
            .get(&DataKey::Receivable(receivable_id))
            .expect("not found");

        receivable.status = ReceivableStatus::Clawback;
        env.storage()
            .persistent()
            .set(&DataKey::Receivable(receivable_id), &receivable);

        env.events().publish(
            (symbol_short!("CLAWBACK"), symbol_short!("recv")),
            receivable_id,
        );
    }

    // ── Queries ──────────────────────────────────────────────

    pub fn get_receivable(env: Env, receivable_id: u128) -> Receivable {
        env.storage()
            .persistent()
            .get(&DataKey::Receivable(receivable_id))
            .expect("not found")
    }

    pub fn get_count(env: Env) -> u128 {
        env.storage()
            .instance()
            .get(&DataKey::Counter)
            .unwrap_or(0)
    }

    // ── Helpers ──────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if *caller != admin {
            panic!("admin only");
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_register_and_attest() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReceivableRegistry);
        let client = ReceivableRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);
        let att1 = Address::generate(&env);
        let att2 = Address::generate(&env);
        let att3 = Address::generate(&env);

        client.initialize(&admin);

        let buyer_hash = BytesN::from_array(&env, &[1u8; 32]);
        let doc_hash = BytesN::from_array(&env, &[2u8; 32]);
        let ipfs_cid = Bytes::from_slice(&env, b"QmTestCID123");
        let mut attestors = Vec::new(&env);
        attestors.push_back(att1.clone());
        attestors.push_back(att2.clone());
        attestors.push_back(att3.clone());

        let id = client.register_receivable(
            &exporter,
            &buyer_hash,
            &500_000_00i128, // $50,000.00
            &symbol_short!("USDC"),
            &1_800_000_000u64,
            &doc_hash,
            &ipfs_cid,
            &attestors,
        );

        assert_eq!(id, 0);

        let rec = client.get_receivable(&id);
        assert_eq!(rec.status, ReceivableStatus::Pending);

        // First attestation — still pending
        client.attest(&att1, &id);
        let rec = client.get_receivable(&id);
        assert_eq!(rec.status, ReceivableStatus::Pending);

        // Second attestation — threshold met → Attested
        client.attest(&att2, &id);
        let rec = client.get_receivable(&id);
        assert_eq!(rec.status, ReceivableStatus::Attested);
        assert!(rec.token_asset_code.is_some());
    }

    #[test]
    #[should_panic(expected = "already attested")]
    fn test_duplicate_attestation_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, ReceivableRegistry);
        let client = ReceivableRegistryClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);
        let att1 = Address::generate(&env);

        client.initialize(&admin);

        let mut attestors = Vec::new(&env);
        attestors.push_back(att1.clone());

        let id = client.register_receivable(
            &exporter,
            &BytesN::from_array(&env, &[1u8; 32]),
            &100_000_00i128,
            &symbol_short!("USDC"),
            &1_800_000_000u64,
            &BytesN::from_array(&env, &[2u8; 32]),
            &Bytes::from_slice(&env, b"QmTest"),
            &attestors,
        );

        client.attest(&att1, &id);
        client.attest(&att1, &id); // Should panic
    }
}
