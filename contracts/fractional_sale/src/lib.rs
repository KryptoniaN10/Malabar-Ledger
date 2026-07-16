// ============================================================
//  FractionalSale — Aletheia
//  Manages fractional sale of attested receivable tokens.
//  Investors purchase shares at a discount; proceeds flow to
//  the exporter immediately when the sale closes.
// ============================================================
#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    token, Address, Env, Map, Symbol, Vec,
};

// ── Data Types ───────────────────────────────────────────────

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum SaleStatus {
    Open,
    Closed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SaleListing {
    pub receivable_id: u128,
    pub exporter: Address,
    pub face_value_cents: i128,        // Full face value in USD cents
    pub discount_bps: u32,             // Discount in basis points (e.g. 500 = 5%)
    pub sale_price_cents: i128,        // face_value * (1 - discount_bps/10000)
    pub min_share_cents: i128,         // Minimum purchasable amount in USD cents
    pub max_share_cents: i128,         // Maximum purchasable amount (0 = unlimited)
    pub total_sold_cents: i128,        // Running total of shares sold
    pub investors: Vec<Address>,       // Ordered list of investors
    pub shares: Map<Address, i128>,    // investor → amount purchased (cents)
    pub status: SaleStatus,
    pub stablecoin_address: Address,   // USDC contract address on Stellar
    pub listed_at: u64,
    pub closed_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Sale(u128),       // keyed by receivable_id
}

// ── Contract ─────────────────────────────────────────────────

#[contract]
pub struct FractionalSale;

#[contractimpl]
impl FractionalSale {
    // ── Initializer ─────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().extend_ttl(17280, 17280);
    }

    // ── Exporter: List receivable for fractional sale ────────

    /// Called by the exporter after their receivable has been attested.
    /// `discount_bps` — discount in basis points (100 bps = 1%).
    ///   A 500 bps discount on a $10,000 receivable means investors pay $9,500.
    /// `min_share_cents` — smallest tranche an investor can buy (e.g. $100 = 10000).
    /// `max_share_cents` — 0 means no upper limit per investor.
    pub fn list_for_sale(
        env: Env,
        exporter: Address,
        receivable_id: u128,
        face_value_cents: i128,
        discount_bps: u32,
        min_share_cents: i128,
        max_share_cents: i128,
        stablecoin_address: Address,
    ) {
        exporter.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Sale(receivable_id))
        {
            panic!("already listed");
        }
        if discount_bps > 2000 {
            // Cap at 20% discount — sanity guard
            panic!("discount too high");
        }
        if min_share_cents <= 0 {
            panic!("min share must be positive");
        }

        let sale_price_cents = face_value_cents
            - (face_value_cents * discount_bps as i128 / 10_000);

        let listing = SaleListing {
            receivable_id,
            exporter,
            face_value_cents,
            discount_bps,
            sale_price_cents,
            min_share_cents,
            max_share_cents,
            total_sold_cents: 0,
            investors: Vec::new(&env),
            shares: Map::new(&env),
            status: SaleStatus::Open,
            stablecoin_address,
            listed_at: env.ledger().timestamp(),
            closed_at: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Sale(receivable_id), &listing);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Sale(receivable_id), 17280, 17280);

        env.events().publish(
            (symbol_short!("LISTED"), symbol_short!("sale")),
            receivable_id,
        );
    }

    // ── Investor: Buy a fractional share ────────────────────

    /// Investor sends stablecoin proportional to their share.
    /// `amount_cents` — how much of the face value they want to buy.
    ///   Investor pays `amount_cents * (1 - discount_bps/10000)`.
    ///
    /// KYC enforcement: The receivable token asset is issued with
    /// AUTH_REQUIRED flag on the Stellar issuer account. The Stellar
    /// protocol prevents any non-authorized trustline from receiving
    /// tokens — so KYC is enforced at the protocol layer automatically.
    pub fn buy_share(
        env: Env,
        investor: Address,
        receivable_id: u128,
        amount_cents: i128,
    ) {
        investor.require_auth();

        let mut listing: SaleListing = env
            .storage()
            .persistent()
            .get(&DataKey::Sale(receivable_id))
            .expect("sale not found");

        if listing.status != SaleStatus::Open {
            panic!("sale not open");
        }
        if amount_cents < listing.min_share_cents {
            panic!("below minimum share");
        }
        if listing.max_share_cents > 0 && amount_cents > listing.max_share_cents {
            panic!("above maximum share");
        }

        let remaining = listing.face_value_cents - listing.total_sold_cents;
        if amount_cents > remaining {
            panic!("exceeds remaining capacity");
        }

        // Calculate discounted payment the investor owes
        let payment = amount_cents
            - (amount_cents * listing.discount_bps as i128 / 10_000);

        // Transfer stablecoin from investor to this contract (escrow)
        let stablecoin = token::Client::new(&env, &listing.stablecoin_address);
        stablecoin.transfer(
            &investor,
            &env.current_contract_address(),
            &payment,
        );

        // Record share
        let existing = listing.shares.get(investor.clone()).unwrap_or(0);
        listing.shares.set(investor.clone(), existing + amount_cents);

        if existing == 0 {
            listing.investors.push_back(investor.clone());
        }

        listing.total_sold_cents += amount_cents;

        env.events().publish(
            (symbol_short!("BOUGHT"), symbol_short!("sale")),
            (receivable_id, investor, amount_cents),
        );

        // Auto-close if fully subscribed
        if listing.total_sold_cents >= listing.face_value_cents {
            Self::close_sale_internal(&env, &mut listing);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Sale(receivable_id), &listing);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Sale(receivable_id), 17280, 17280);
    }

    // ── Exporter / Admin: Close sale and release funds ───────

    /// Closes the sale window and releases discounted proceeds to the exporter.
    /// Can be called by the exporter once enough is subscribed, or auto-called
    /// when face value is fully subscribed.
    pub fn close_sale(env: Env, caller: Address, receivable_id: u128) {
        caller.require_auth();

        let mut listing: SaleListing = env
            .storage()
            .persistent()
            .get(&DataKey::Sale(receivable_id))
            .expect("sale not found");

        if listing.status != SaleStatus::Open {
            panic!("sale not open");
        }

        // Only exporter or admin can manually close
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");

        if caller != listing.exporter && caller != admin {
            panic!("unauthorized");
        }

        Self::close_sale_internal(&env, &mut listing);

        env.storage()
            .persistent()
            .set(&DataKey::Sale(receivable_id), &listing);
    }

    // ── Exporter: Update discount while sale is Open ─────────

    /// Called by the exporter (or admin) to adjust the discount rate
    /// while the sale is still open. Investors who have already bought
    /// shares are NOT retroactively affected; only future purchases use
    /// the new rate.
    ///
    /// `new_discount_bps` — new discount in basis points (1 to 2000).
    pub fn update_discount(
        env: Env,
        exporter: Address,
        receivable_id: u128,
        new_discount_bps: u32,
    ) {
        exporter.require_auth();

        let mut listing: SaleListing = env
            .storage()
            .persistent()
            .get(&DataKey::Sale(receivable_id))
            .expect("sale not found");

        if listing.status != SaleStatus::Open {
            panic!("sale not open");
        }

        // Only the original exporter or the admin may change the rate
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        if exporter != listing.exporter && exporter != admin {
            panic!("unauthorized");
        }

        if new_discount_bps == 0 {
            panic!("discount must be at least 1 bps");
        }
        if new_discount_bps > 2000 {
            panic!("discount too high");
        }

        listing.discount_bps = new_discount_bps;
        // Recalculate the effective sale price for the remaining capacity
        listing.sale_price_cents = listing.face_value_cents
            - (listing.face_value_cents * new_discount_bps as i128 / 10_000);

        env.storage()
            .persistent()
            .set(&DataKey::Sale(receivable_id), &listing);
        env.storage()
            .persistent()
            .extend_ttl(&DataKey::Sale(receivable_id), 17280, 17280);

        env.events().publish(
            (symbol_short!("DISCUPD"), symbol_short!("sale")),
            (receivable_id, new_discount_bps),
        );
    }

    fn close_sale_internal(env: &Env, listing: &mut SaleListing) {
        // Calculate total stablecoin collected
        // = sum of (share_i * (1 - discount_bps/10000)) over all investors
        let total_collected: i128 = listing.total_sold_cents
            - (listing.total_sold_cents * listing.discount_bps as i128 / 10_000);

        // Release all collected stablecoin to exporter immediately
        if total_collected > 0 {
            let stablecoin = token::Client::new(env, &listing.stablecoin_address);
            stablecoin.transfer(
                &env.current_contract_address(),
                &listing.exporter,
                &total_collected,
            );
        }

        listing.status = SaleStatus::Closed;
        listing.closed_at = env.ledger().timestamp();

        env.events().publish(
            (symbol_short!("CLOSED"), symbol_short!("sale")),
            (listing.receivable_id, total_collected),
        );
    }

    // ── Queries ──────────────────────────────────────────────

    pub fn get_sale(env: Env, receivable_id: u128) -> SaleListing {
        env.storage()
            .persistent()
            .get(&DataKey::Sale(receivable_id))
            .expect("not found")
    }

    pub fn get_investor_share(
        env: Env,
        receivable_id: u128,
        investor: Address,
    ) -> i128 {
        let listing: SaleListing = env
            .storage()
            .persistent()
            .get(&DataKey::Sale(receivable_id))
            .expect("not found");
        listing.shares.get(investor).unwrap_or(0)
    }
}

// ── Tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
        token::{Client as TokenClient, StellarAssetClient},
        Env,
    };

    fn create_token(env: &Env, admin: &Address) -> (Address, StellarAssetClient) {
        let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
        let sac = StellarAssetClient::new(env, &contract_id.address());
        (contract_id.address(), sac)
    }

    #[test]
    fn test_list_and_buy_share() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);
        let investor = Address::generate(&env);

        // Deploy sale contract
        let sale_id = env.register_contract(None, FractionalSale);
        let client = FractionalSaleClient::new(&env, &sale_id);
        client.initialize(&admin);

        // Create USDC token
        let (usdc_addr, usdc_admin) = create_token(&env, &admin);
        usdc_admin.mint(&investor, &500_000_00); // $500,000

        // List receivable for sale: $100,000 face value, 5% discount
        client.list_for_sale(
            &exporter,
            &0u128,
            &100_000_00i128, // $100,000
            &500u32,         // 5% discount = 500 bps
            &1_000_00i128,   // min $1,000
            &0i128,          // no max
            &usdc_addr,
        );

        // Investor buys $40,000 face value
        client.buy_share(&investor, &0u128, &40_000_00i128);

        let sale = client.get_sale(&0u128);
        assert_eq!(sale.total_sold_cents, 40_000_00);
        assert_eq!(sale.status, SaleStatus::Open);

        let share = client.get_investor_share(&0u128, &investor);
        assert_eq!(share, 40_000_00);
    }

    #[test]
    fn test_auto_close_on_full_subscription() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);
        let investor = Address::generate(&env);

        let sale_id = env.register_contract(None, FractionalSale);
        let client = FractionalSaleClient::new(&env, &sale_id);
        client.initialize(&admin);

        let (usdc_addr, usdc_admin) = create_token(&env, &admin);
        usdc_admin.mint(&investor, &200_000_00);

        client.list_for_sale(
            &exporter,
            &0u128,
            &100_000_00i128,
            &200u32, // 2% discount
            &100_00i128,
            &0i128,
            &usdc_addr,
        );

        // Buy exactly the full face value — should auto-close
        client.buy_share(&investor, &0u128, &100_000_00i128);

        let sale = client.get_sale(&0u128);
        assert_eq!(sale.status, SaleStatus::Closed);
    }

    #[test]
    fn test_update_discount_happy_path() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);

        let sale_id = env.register_contract(None, FractionalSale);
        let client = FractionalSaleClient::new(&env, &sale_id);
        client.initialize(&admin);

        let (usdc_addr, _) = create_token(&env, &admin);

        // List at 5% discount
        client.list_for_sale(
            &exporter,
            &0u128,
            &100_000_00i128,
            &500u32,  // 5%
            &1_000_00i128,
            &0i128,
            &usdc_addr,
        );

        // Exporter raises to 8%
        client.update_discount(&exporter, &0u128, &800u32);

        let sale = client.get_sale(&0u128);
        assert_eq!(sale.discount_bps, 800);
        // face_value=10_000_000 cents, 8% off = 9_200_000 cents
        assert_eq!(sale.sale_price_cents, 100_000_00 - (100_000_00 * 800 / 10_000));
    }

    #[test]
    #[should_panic(expected = "sale not open")]
    fn test_update_discount_after_close_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);
        let investor = Address::generate(&env);

        let sale_id = env.register_contract(None, FractionalSale);
        let client = FractionalSaleClient::new(&env, &sale_id);
        client.initialize(&admin);

        let (usdc_addr, usdc_admin) = create_token(&env, &admin);
        usdc_admin.mint(&investor, &200_000_00);

        client.list_for_sale(
            &exporter,
            &0u128,
            &100_000_00i128,
            &500u32,
            &100_00i128,
            &0i128,
            &usdc_addr,
        );

        // Buy full face value → auto-close
        client.buy_share(&investor, &0u128, &100_000_00i128);

        // Should panic: sale is now Closed
        client.update_discount(&exporter, &0u128, &700u32);
    }

    #[test]
    #[should_panic(expected = "discount too high")]
    fn test_update_discount_cap_enforced() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let exporter = Address::generate(&env);

        let sale_id = env.register_contract(None, FractionalSale);
        let client = FractionalSaleClient::new(&env, &sale_id);
        client.initialize(&admin);

        let (usdc_addr, _) = create_token(&env, &admin);

        client.list_for_sale(
            &exporter,
            &0u128,
            &100_000_00i128,
            &500u32,
            &100_00i128,
            &0i128,
            &usdc_addr,
        );

        // 25% — over the 20% cap
        client.update_discount(&exporter, &0u128, &2500u32);
    }
}
