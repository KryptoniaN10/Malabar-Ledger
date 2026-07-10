import React, { useState, useEffect } from 'react';
import ReceivableCard from '../components/ReceivableCard.jsx';
import SharePurchaseModal from '../components/SharePurchaseModal.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import DexListingPanel from '../components/DexListingPanel.jsx';
import { useReceivables } from '../hooks/useReceivables.js';
import { receivablesApi, authApi, formatUsd, daysUntil, formatYield } from '../stellar/client.js';

export default function InvestorDashboard({ walletAddress, onConnect }) {
  const { receivables, loading, refresh } = useReceivables({}, 10000);
  const [selectedRec, setSelectedRec] = useState(null);
  const [kycStatus, setKycStatus] = useState(null);
  const [kycForm, setKycForm] = useState({ name: '', email: '', pan_number: '' });
  const [kycLoading, setKycLoading] = useState(false);
  const [filter, setFilter] = useState('active');
  const [portfolioTab, setPortfolioTab] = useState('open');

  // My investments — computed from all receivables
  const myInvestments = receivables.flatMap((r) =>
    (r.investments || [])
      .filter((inv) => inv.investor_address === walletAddress)
      .map((inv) => ({ ...inv, receivable: r }))
  );

  const openPositions = myInvestments.filter((i) => i.receivable?.status !== 'settled');
  const closedPositions = myInvestments.filter((i) => i.receivable?.status === 'settled');

  // Portfolio stats
  const totalDeployed = myInvestments.reduce((s, i) => s + i.payment_cents / 100, 0);
  const totalFaceValue = myInvestments.reduce((s, i) => s + i.share_cents / 100, 0);
  const expectedProfit = totalFaceValue - totalDeployed;
  const avgYieldPct = totalDeployed > 0 ? (expectedProfit / totalDeployed * 100).toFixed(1) : 0;

  // KYC status
  useEffect(() => {
    if (!walletAddress) return;
    authApi.checkWalletKyc(walletAddress).then(setKycStatus).catch(() => {});
  }, [walletAddress]);

  async function handleKycSubmit(e) {
    e.preventDefault();
    if (!walletAddress) return;
    setKycLoading(true);
    try {
      const session = await authApi.startKyc({ wallet_address: walletAddress, ...kycForm });
      setKycStatus({ kyc_status: 'pending', session_id: session.session_id });
    } catch (err) {
      alert(err.message);
    }
    setKycLoading(false);
  }

  const filtered = receivables.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  return (
    <main className="page-content">
      <div className="container">

        {/* ── Header ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="section-label">Investor Portal</div>
          <h1 style={{ marginBottom: 'var(--space-3)' }}>
            Earn real yield from{' '}
            <span className="shine-saffron">Malabar exports</span>
          </h1>
          <p className="text-secondary text-ui-lg" style={{ maxWidth: 580 }}>
            Buy fractional shares of verified Kerala export receivables at a discount.
            Backed by real shipping documents. Settled on Stellar.
          </p>
        </div>

        {/* ── Wallet gate ─────────────────────────────────────────── */}
        {!walletAddress && (
          <div className="card" style={{ marginBottom: 'var(--space-6)', display: 'flex', gap: 'var(--space-5)', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '2.5rem' }}>👜</div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3 style={{ marginBottom: 'var(--space-2)' }}>Connect Your Wallet</h3>
              <p className="text-secondary text-ui-sm">
                Freighter wallet required to invest. KYC approval needed to receive receivable tokens
                — we sponsor the XLM reserve so you don't need any.
              </p>
            </div>
            <button className="btn btn-primary" onClick={onConnect} id="investor-connect-btn">
              Connect Freighter
            </button>
          </div>
        )}

        {/* ── Portfolio Stats row (when invested) ─────────────────── */}
        {walletAddress && myInvestments.length > 0 && (
          <div className="grid-4" style={{ marginBottom: 'var(--space-6)' }}>
            {[
              { label: 'Positions',        value: myInvestments.length,                       color: 'var(--color-teal-light)' },
              { label: 'Capital Deployed', value: formatUsd(totalDeployed * 100),             color: 'var(--color-saffron)'   },
              { label: 'Face Value Held',  value: formatUsd(totalFaceValue * 100),            color: 'var(--color-text-primary)' },
              { label: 'Expected Profit',  value: `+${formatUsd(expectedProfit * 100)}`,      color: 'var(--color-green-light)' },
            ].map((s) => (
              <div key={s.label} className="card stat-card">
                <div className="stat-value" style={{ color: s.color, fontSize: '1.5rem' }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid-2" style={{ gap: 'var(--space-7)', alignItems: 'start' }}>

          {/* ── Left: Marketplace ──────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', flex: 1 }}>
                Receivables Marketplace
              </h3>
              <div className="flex gap-2">
                {[
                  { key: 'active',   label: 'For Sale' },
                  { key: 'attested', label: 'Attested' },
                  { key: 'all',      label: 'All'      },
                ].map((f) => (
                  <button
                    key={f.key}
                    className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFilter(f.key)}
                    id={`filter-${f.key}-btn`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col gap-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 220 }} />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
                <div style={{ fontSize: '2rem', marginBottom: 'var(--space-3)' }}>🌊</div>
                <div className="text-secondary">
                  No {filter === 'active' ? 'open' : filter} receivables right now.
                  <br />
                  <span className="text-ui-xs text-muted">
                    Ask an admin to register and attest a receivable, or run{' '}
                    <span className="monospace">npm run seed</span> in the API.
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {filtered.map((rec) => (
                  <ReceivableCard
                    key={rec.id}
                    receivable={rec}
                    showInvest
                    onClick={() => setSelectedRec(rec)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Right column ───────────────────────────────────────── */}
          <div className="flex flex-col gap-5">

            {/* KYC Panel */}
            <div className="card card-gold">
              <h4 style={{ marginBottom: 'var(--space-3)', fontFamily: 'var(--font-display)' }}>
                Identity Verification (KYC)
              </h4>

              {!walletAddress ? (
                <div className="text-ui-sm text-muted">
                  Connect your wallet to check KYC status
                </div>
              ) : kycStatus?.approved ? (
                <div>
                  <div className="alert alert-success" style={{ marginBottom: 'var(--space-3)' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>✓ KYC Approved</div>
                      <div className="text-ui-sm">
                        Your wallet is authorized to hold receivable tokens.
                        Your trustline reserve is sponsored — no XLM needed.
                      </div>
                    </div>
                  </div>
                  <div className="text-ui-xs text-muted">
                    <span className="badge badge-attested" style={{ fontSize: '0.62rem', marginRight: 6 }}>SEP-24</span>
                    Verified via Stellar Anchor mock KYC flow
                  </div>
                </div>
              ) : kycStatus?.kyc_status === 'pending' || kycStatus?.status === 'pending' ? (
                <div>
                  <div className="alert alert-warning">
                    <div>
                      <div style={{ fontWeight: 700 }}>⏳ KYC Under Review</div>
                      <div className="text-ui-sm">
                        Your application is with the compliance team.
                        An admin will approve it shortly — visible in the Admin panel.
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleKycSubmit}>
                  <p className="text-ui-sm text-secondary" style={{ marginBottom: 'var(--space-4)' }}>
                    Required to receive receivable tokens (Stellar AUTH_REQUIRED).
                    This mock SEP-24 flow collects basic details — replaced by
                    a real Anchor in production.
                  </p>
                  <div className="flex flex-col gap-3">
                    <div className="form-group">
                      <label className="form-label">Full Name</label>
                      <input
                        className="form-input"
                        value={kycForm.name}
                        onChange={(e) => setKycForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Your legal name"
                        required
                        id="kyc-name-input"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input
                        className="form-input"
                        type="email"
                        value={kycForm.email}
                        onChange={(e) => setKycForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="you@example.com"
                        required
                        id="kyc-email-input"
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">PAN / Passport No.</label>
                      <input
                        className="form-input"
                        value={kycForm.pan_number}
                        onChange={(e) => setKycForm((f) => ({ ...f, pan_number: e.target.value }))}
                        placeholder="ABCDE1234F"
                        id="kyc-pan-input"
                      />
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-full"
                    style={{ marginTop: 'var(--space-4)' }}
                    type="submit"
                    disabled={kycLoading}
                    id="kyc-submit-btn"
                  >
                    {kycLoading ? 'Submitting…' : 'Start KYC (SEP-24 mock)'}
                  </button>
                </form>
              )}
            </div>

            {/* Portfolio Panel */}
            {walletAddress && myInvestments.length > 0 && (
              <div className="card">
                <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-4)' }}>
                  <h4 style={{ fontFamily: 'var(--font-display)', flex: 1 }}>My Portfolio</h4>
                  <div className="flex gap-2">
                    {['open', 'closed'].map((t) => (
                      <button
                        key={t}
                        className={`btn btn-sm ${portfolioTab === t ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPortfolioTab(t)}
                        id={`portfolio-tab-${t}`}
                        style={{ textTransform: 'capitalize' }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {(portfolioTab === 'open' ? openPositions : closedPositions).map((inv, idx) => (
                    <PortfolioPosition
                      key={idx}
                      investment={inv}
                      walletAddress={walletAddress}
                      onDexSuccess={refresh}
                    />
                  ))}
                  {(portfolioTab === 'open' ? openPositions : closedPositions).length === 0 && (
                    <div className="text-ui-sm text-muted" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                      No {portfolioTab} positions
                    </div>
                  )}
                </div>

                {avgYieldPct > 0 && (
                  <div style={{
                    marginTop: 'var(--space-4)',
                    paddingTop: 'var(--space-3)',
                    borderTop: '1px solid var(--color-border)',
                  }}>
                    <div className="text-ui-xs text-muted">
                      Blended portfolio return:{' '}
                      <span style={{ color: 'var(--color-green-light)', fontWeight: 700 }}>
                        +{avgYieldPct}%
                      </span>{' '}
                      on deployed capital
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Live Feed */}
            <div className="card">
              <LiveFeed walletAddress={walletAddress} />
            </div>

            {/* Stellar primitives info strip */}
            <div style={{
              padding: 'var(--space-4)',
              background: 'rgba(13,154,168,0.04)',
              border: '1px solid rgba(13,154,168,0.15)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div className="section-label" style={{ marginBottom: 'var(--space-3)' }}>Stellar Primitives</div>
              {[
                { icon: '🔐', label: 'AUTH_REQUIRED', desc: 'Only KYC-approved wallets receive tokens' },
                { icon: '🛡️', label: 'CLAWBACK_ENABLED', desc: 'Fraud recovery at protocol level' },
                { icon: '🤝', label: 'Sponsored Reserves', desc: 'Zero XLM required to hold tokens' },
                { icon: '📊', label: 'Native DEX',  desc: 'Exit before maturity via ManageSellOffer' },
              ].map((p) => (
                <div key={p.label} className="flex items-center gap-2" style={{ marginBottom: 'var(--space-2)' }}>
                  <span>{p.icon}</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-teal-light)' }}>
                    {p.label}
                  </span>
                  <span className="text-ui-xs text-muted">— {p.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Purchase Modal ─────────────────────────────────────── */}
        {selectedRec && (
          <SharePurchaseModal
            receivable={selectedRec}
            investorAddress={walletAddress}
            onClose={() => setSelectedRec(null)}
            onSuccess={() => {
              setSelectedRec(null);
              refresh();
            }}
          />
        )}
      </div>
    </main>
  );
}

// ── Portfolio Position Row ────────────────────────────────────
function PortfolioPosition({ investment, walletAddress, onDexSuccess }) {
  const { receivable, share_cents, payment_cents } = investment;
  const faceValueUsd = share_cents / 100;
  const paidUsd = payment_cents / 100;
  const profitUsd = faceValueUsd - paidUsd;
  const days = receivable?.maturity_date ? daysUntil(receivable.maturity_date) : null;

  const statusDot = {
    pending: '#e8a020',
    attested: 'var(--color-teal-light)',
    active: 'var(--color-green-light)',
    settled: '#8fa8ff',
    clawback: '#f08080',
  };

  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
        <div>
          <div className="flex items-center gap-2">
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: statusDot[receivable?.status] || 'var(--color-border)',
              flexShrink: 0,
            }} />
            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
              {receivable?.commodity || 'Receivable'} #{receivable?.id}
            </span>
          </div>
          <div className="text-ui-xs text-muted" style={{ marginTop: 2, marginLeft: 16 }}>
            {receivable?.buyer_name} · {receivable?.buyer_country} · {days !== null ? `${days}d to maturity` : 'matured'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: 'var(--color-teal-light)', fontSize: '0.9rem' }}>
            {formatUsd(share_cents)}
          </div>
          <div className="text-ui-xs" style={{ color: profitUsd > 0 ? 'var(--color-green-light)' : 'var(--color-text-muted)' }}>
            {profitUsd > 0 ? '+' : ''}{formatUsd(profitUsd * 100)} profit
          </div>
        </div>
      </div>

      {/* Progress bar showing time to maturity */}
      {days !== null && receivable?.status !== 'settled' && (
        <div style={{ marginBottom: 'var(--space-2)' }}>
          <div style={{
            height: 3, background: 'var(--color-border)',
            borderRadius: 2, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.max(5, 100 - (days / 90) * 100)}%`,
              background: 'var(--gradient-brand)',
              borderRadius: 2,
            }} />
          </div>
        </div>
      )}

      {receivable?.token_asset_code && receivable?.status !== 'settled' && (
        <DexListingPanel
          investment={investment}
          walletAddress={walletAddress}
          onSuccess={onDexSuccess}
        />
      )}

      {/* Token link */}
      {receivable?.token_asset_code && (
        <div style={{ marginTop: 4 }}>
          {receivable.issuer_public_key && !receivable.issuer_public_key.startsWith('demo') ? (
            <a
              href={`https://stellar.expert/explorer/testnet/asset/${receivable.token_asset_code}-${receivable.issuer_public_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ui-xs"
              style={{ color: 'var(--color-teal-light)', textDecoration: 'underline', opacity: 0.8 }}
            >
              {receivable.token_asset_code} on Stellar Expert ↗
            </a>
          ) : (
            <span className="text-ui-xs text-muted">{receivable.token_asset_code} (local demo)</span>
          )}
        </div>
      )}

      {receivable?.status === 'settled' && (
        <div className="text-ui-xs" style={{ color: '#8fa8ff', marginTop: 4 }}>
          ✓ Settled — {formatUsd(share_cents)} returned to your wallet
        </div>
      )}
    </div>
  );
}
