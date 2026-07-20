import React, { useState, useEffect } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { receivablesApi, formatUsd, daysUntil, formatYield } from '../stellar/client.js';
import SharePurchaseModal from '../components/SharePurchaseModal.jsx';
import VerifiedBadge from '../components/VerifiedBadge.jsx';
import ProgressBar from '../components/ProgressBar.jsx';

export default function ReceivableDetail({ walletAddress, onConnect, onOpenLogin }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isFromHomeFlow = location.state?.fromHome;
  const [receivable, setReceivable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showPurchase, setShowPurchase] = useState(false);

  useEffect(() => {
    const pendingId = localStorage.getItem('pendingPurchaseId');
    if (pendingId === id && walletAddress) {
      localStorage.removeItem('pendingPurchaseId');
      setShowPurchase(true);
    }
  }, [walletAddress, id]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await receivablesApi.get(id);
      setReceivable(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDetails();
  }, [id]);

  if (loading) {
    return (
      <div className="page-content flex justify-center items-center">
        <div className="spinner" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  if (error || !receivable) {
    return (
      <div className="page-content">
        <div className="container-narrow">
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-2)' }}>Error Loading Receivable</h3>
            <p className="text-secondary" style={{ marginBottom: 'var(--space-4)' }}>{error || 'Receivable manifest not found.'}</p>
            <Link to="/marketplace" state={{ fromHome: isFromHomeFlow }} className="btn btn-primary">Back to Marketplace</Link>
          </div>
        </div>
      </div>
    );
  }

  const {
    commodity,
    amount_usd,
    maturity_date,
    discount_bps = 500,
    status,
    exporter_name,
    exporter_address,
    buyer_country,
    doc_hash,
    ipfs_cid,
    token_asset_code,
    investments = [],
    created_at,
    // Stellar Expert deep links (populated from real on-chain tx hashes)
    stellar_expert_transaction_url,
    stellar_expert_registry_url,
    stellar_expert_mint_url,
    stellar_expert_list_url,
  } = receivable;

  const totalInvested = investments.reduce((s, i) => s + (i.share_cents / 100), 0);
  const pctSold = amount_usd > 0 ? (totalInvested / amount_usd) * 100 : 0;
  const remaining = Math.max(0, amount_usd - totalInvested);
  const days = daysUntil(maturity_date);
  const { discount, apy } = formatYield(discount_bps, days);

  // Avoid duplicating the "latest tx" link in secondary links
  const secondaryRegistryUrl =
    stellar_expert_registry_url !== stellar_expert_transaction_url ? stellar_expert_registry_url : null;
  const secondaryMintUrl =
    stellar_expert_mint_url !== stellar_expert_transaction_url ? stellar_expert_mint_url : null;
  const secondaryListUrl =
    stellar_expert_list_url !== stellar_expert_transaction_url ? stellar_expert_list_url : null;

  return (
    <main className="page-content">
      <div className="container">
        {/* Back Link */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Link to="/marketplace" state={{ fromHome: isFromHomeFlow }} style={{ color: 'var(--color-teal)', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', fontWeight: 600 }}>
            ← Back to Marketplace
          </Link>
        </div>

        {/* Layout Grid */}
        <div className="grid-3" style={{ gap: 'var(--space-6)', alignItems: 'start', gridTemplateColumns: '2fr 1fr' }}>
          {/* Manifest details (left) */}
          <div className="flex flex-col gap-5">
            {/* Header Manifest Card */}
            <div className="card" style={{ borderLeft: '4px solid var(--color-teal)' }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="section-label" style={{ margin: 0 }}>Manifest #{id}</span>
                  {token_asset_code && (
                    <span className="monospace text-ui-xs text-accent" style={{ background: 'rgba(14,77,74,0.08)', padding: '2px 6px', borderRadius: '4px' }}>
                      {token_asset_code}
                    </span>
                  )}
                </div>
                <span className={`badge badge-${status}`}>● {status.toUpperCase()}</span>
              </div>

              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', marginBottom: 'var(--space-2)' }}>
                Export of {commodity}
              </h1>
              <p className="text-secondary text-ui-md" style={{ marginBottom: 'var(--space-4)' }}>
                Origin: <strong>Kochi Port, India</strong> · Destination: <strong>{buyer_country}</strong>
              </p>

              <div className="grid-3" style={{ gap: 'var(--space-4)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
                <div>
                  <span className="form-label" style={{ fontSize: '0.65rem' }}>Invoice Value</span>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-teal)' }}>
                    {formatUsd(amount_usd * 100)}
                  </div>
                </div>
                <div>
                  <span className="form-label" style={{ fontSize: '0.65rem' }}>Yield (Discount)</span>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-saffron)' }}>
                    {discount}
                  </div>
                </div>
                <div>
                  <span className="form-label" style={{ fontSize: '0.65rem' }}>Maturity Term</span>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 700 }}>
                    {days} Days
                  </div>
                </div>
              </div>
            </div>

            {/* Exporter Info Card */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-3)' }}>Exporter &amp; Shipping Manifest</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
                  <span className="text-ui-sm text-secondary">Exporter</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600 }}>{exporter_name || 'Aged Spices Exporters'}</span>
                    <VerifiedBadge />
                  </div>
                </div>
                <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
                  <span className="text-ui-sm text-secondary">Port of Loading</span>
                  <span style={{ fontWeight: 500 }}>Kochi Port (INCOK)</span>
                </div>
                <div className="flex justify-between items-center" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '8px' }}>
                  <span className="text-ui-sm text-secondary">Stellar Account</span>
                  <span className="monospace text-ui-xs text-muted" title={exporter_address}>
                    {exporter_address ? `${exporter_address.slice(0, 10)}...${exporter_address.slice(-8)}` : 'Demo'}
                  </span>
                </div>
              </div>
            </div>

            {/* Document Hash Verification */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-3)' }}>On-Chain Audit Manifest</h3>
              <p className="text-ui-sm text-secondary" style={{ marginBottom: 'var(--space-4)' }}>
                This trade bill is secured on the Stellar blockchain. Document validation hashes match off-chain IPFS assets directly.
              </p>

              <div className="flex flex-col gap-3">
                <div style={{ background: 'var(--color-bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                  <span className="form-label" style={{ fontSize: '0.65rem', display: 'block', marginBottom: '4px' }}>Document Hash (SHA-256)</span>
                  <span className="monospace text-ui-xs text-teal" style={{ wordBreak: 'break-all', fontWeight: 600 }}>{doc_hash || 'Unassigned'}</span>
                </div>
                <div style={{ background: 'var(--color-bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                  <span className="form-label" style={{ fontSize: '0.65rem', display: 'block', marginBottom: '4px' }}>IPFS Reference CID</span>
                  <span className="monospace text-ui-xs text-secondary" style={{ wordBreak: 'break-all' }}>{ipfs_cid || 'Unassigned'}</span>
                </div>

                {/* Stellar Expert on-chain links — only shown when at least one real tx hash exists */}
                {(stellar_expert_transaction_url || secondaryRegistryUrl || secondaryMintUrl || secondaryListUrl) && (
                  <div style={{ background: 'var(--color-bg-elevated)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(0,201,167,0.2)' }}>
                    <span className="form-label" style={{ fontSize: '0.65rem', display: 'block', marginBottom: '8px' }}>Stellar Testnet Transactions</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {stellar_expert_transaction_url && (
                        <a
                          href={stellar_expert_transaction_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-teal-light)', fontSize: '0.75rem', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          View latest transaction on Stellar Expert →
                        </a>
                      )}
                      {secondaryListUrl && (
                        <a
                          href={secondaryListUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-saffron)', fontSize: '0.75rem', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          🏷️ Listing TX on Stellar Expert ↗
                        </a>
                      )}
                      {secondaryMintUrl && (
                        <a
                          href={secondaryMintUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-saffron)', fontSize: '0.75rem', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          🪙 Token Mint TX on Stellar Expert ↗
                        </a>
                      )}
                      {secondaryRegistryUrl && (
                        <a
                          href={secondaryRegistryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          📄 Registration TX on Stellar Expert ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Investment Sidebar (right) */}
          <div className="flex flex-col gap-5">
            {/* Purchase Control Panel */}
            <div className="card card-gold">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-3)' }}>Investment Panel</h3>

              {status === 'active' ? (
                <>
                  <div style={{ marginBottom: 'var(--space-4)' }}>
                    <ProgressBar progress={pctSold} />
                  </div>

                  <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-3)' }}>
                    <span className="text-ui-sm text-secondary">Remaining Cap</span>
                    <span style={{ fontWeight: 700, color: 'var(--color-teal)' }}>{formatUsd(remaining * 100)}</span>
                  </div>

                  <button
                    className="btn btn-primary btn-full"
                    onClick={() => {
                      if (walletAddress) {
                        setShowPurchase(true);
                      } else {
                        localStorage.setItem('pendingPurchaseId', id);
                        navigate('/login');
                      }
                    }}
                  >
                    Invest in Receivable
                  </button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 'var(--space-4) 0' }}>
                  <span style={{ fontSize: '2rem', display: 'block', marginBottom: '8px' }}>🔒</span>
                  <h4 style={{ fontFamily: 'var(--font-display)', marginBottom: '4px' }}>Funding Closed</h4>
                  <p className="text-ui-xs text-muted">This manifest status is currently {status}.</p>
                </div>
              )}
            </div>

            {/* APY Calculator */}
            {status === 'active' && apy && (
              <div className="card" style={{ background: 'var(--color-bg-elevated)', borderStyle: 'dashed' }}>
                <h4 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-saffron)', marginBottom: 'var(--space-2)' }}>Yield Projections</h4>
                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
                  <span className="text-ui-xs text-secondary">Discount Rate</span>
                  <span style={{ fontWeight: 600 }}>{discount}</span>
                </div>
                <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-2)' }}>
                  <span className="text-ui-xs text-secondary">Annualized APY</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-green)' }}>{apy}</span>
                </div>
                <p className="text-ui-xs text-muted" style={{ marginTop: 'var(--space-3)', lineHeight: 1.5 }}>
                  * Annualized calculations based on invoice maturity timeline. Payout is guaranteed by the Escrow Settlement Contract once the importer clears invoice.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Transaction History Section */}
        {investments.length > 0 && (
          <div className="card" style={{ marginTop: 'var(--space-6)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-4)' }}>Co-Investment ledger</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', opacity: 0.6 }}>
                  <th style={{ padding: '8px 12px' }} className="form-label">Investor Address</th>
                  <th style={{ padding: '8px 12px' }} className="form-label">Face Value Share</th>
                  <th style={{ padding: '8px 12px' }} className="form-label">Purchase Price</th>
                  <th style={{ padding: '8px 12px' }} className="form-label">Transaction Hash</th>
                </tr>
              </thead>
              <tbody>
                {investments.map((inv, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <td style={{ padding: '12px' }} className="monospace">
                      {inv.investor_address.slice(0, 12)}...{inv.investor_address.slice(-10)}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 600, color: 'var(--color-teal)' }}>
                      {formatUsd(inv.share_cents)}
                    </td>
                    <td style={{ padding: '12px', fontWeight: 500 }}>
                      {formatUsd(inv.payment_cents)}
                    </td>
                    <td style={{ padding: '12px' }} className="monospace text-muted">
                      {inv.tx_hash && !inv.tx_hash.startsWith('demo') ? (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${inv.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--color-teal-light)', textDecoration: 'underline', fontSize: '0.75rem' }}
                          title={inv.tx_hash}
                        >
                          {inv.tx_hash.slice(0, 8)}… ↗
                        </a>
                      ) : (
                        <span style={{ opacity: 0.5 }}>{inv.tx_hash ? `${inv.tx_hash.slice(0, 8)}...` : 'Demo Mode'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Share Purchase Modal */}
        {showPurchase && (
          <SharePurchaseModal
            receivable={receivable}
            investorAddress={walletAddress}
            onClose={() => setShowPurchase(false)}
            onSuccess={() => {
              setShowPurchase(false);
              fetchDetails();
            }}
          />
        )}
      </div>
    </main>
  );
}
