import React, { useState, useEffect } from 'react';
import { useReceivables } from '../hooks/useReceivables.js';
import { receivablesApi, authApi, formatUsd, daysUntil, formatYield } from '../stellar/client.js';
import StatCard from '../components/StatCard.jsx';
import VerifiedBadge from '../components/VerifiedBadge.jsx';

export default function InvestorDashboard({ walletAddress, onConnect }) {
  const { receivables, loading, refresh } = useReceivables({}, 10000);
  const [kycStatus, setKycStatus] = useState(null);
  const [kycForm, setKycForm] = useState({ name: '', email: '', pan_number: '' });
  const [kycLoading, setKycLoading] = useState(false);

  // My investments — computed from all receivables
  const myInvestments = receivables.flatMap((r) =>
    (r.investments || [])
      .filter((inv) => inv.investor_address === walletAddress)
      .map((inv) => ({ ...inv, receivable: r }))
  );

  // Portfolio metrics
  const totalDeployed = myInvestments.reduce((s, i) => s + i.payment_cents / 100, 0);
  const totalFaceValue = myInvestments.reduce((s, i) => s + i.share_cents / 100, 0);
  const expectedProfit = totalFaceValue - totalDeployed;
  const avgYieldPct = totalDeployed > 0 ? ((expectedProfit / totalDeployed) * 100).toFixed(1) : 0;

  // KYC status check
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

  return (
    <main className="page-content">
      <div className="container">
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="section-label" style={{ color: 'var(--color-saffron)' }}>Investor Ledger</div>
          <h1 style={{ marginBottom: 'var(--space-2)' }}>
            Portfolio <span style={{ color: 'var(--color-teal)' }}>Summary</span>
          </h1>
          <p className="text-secondary text-ui-sm">
            Monitor and manage your fractional trade invoice investments.
          </p>
        </div>

        {/* Wallet Gate */}
        {!walletAddress ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', alignItems: 'center', textAlign: 'center', padding: 'var(--space-7)' }}>
            <span style={{ fontSize: '2.5rem' }}>👛</span>
            <h3>Freighter Wallet Required</h3>
            <p className="text-secondary text-ui-sm" style={{ maxWidth: '400px' }}>
              Connect your Freighter wallet to view your active holdings and submit KYC information for regulatory clearance.
            </p>
            <button className="btn btn-primary" onClick={onConnect}>
              Connect Wallet
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* KYC Banner */}
            {kycStatus?.kyc_status !== 'approved' && (
              <div 
                className="card" 
                style={{ 
                  borderLeft: '4px solid var(--color-saffron)',
                  background: 'var(--color-bg-elevated)',
                  display: 'flex',
                  gap: 'var(--space-4)',
                  alignItems: 'start'
                }}
              >
                <div style={{ fontSize: '1.5rem' }}>⚠️</div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ color: 'var(--color-saffron)', marginBottom: '4px' }}>KYC Authorization Required</h4>
                  <p className="text-ui-xs text-secondary" style={{ marginBottom: 'var(--space-3)' }}>
                    {kycStatus?.kyc_status === 'pending'
                      ? 'Your compliance documents are under review. Payouts will trigger once approved.'
                      : 'You must complete investor verification before receiving tokenized trade shares.'}
                  </p>

                  {kycStatus?.kyc_status !== 'pending' && (
                    <form onSubmit={handleKycSubmit} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', maxWidth: '600px' }}>
                      <input 
                        type="text" 
                        placeholder="Full Name" 
                        className="form-input" 
                        required 
                        style={{ flex: 1, minWidth: '150px', padding: '6px 12px', fontSize: '0.85rem' }} 
                        value={kycForm.name} 
                        onChange={(e) => setKycForm({ ...kycForm, name: e.target.value })}
                      />
                      <input 
                        type="email" 
                        placeholder="Email Address" 
                        className="form-input" 
                        required 
                        style={{ flex: 1, minWidth: '150px', padding: '6px 12px', fontSize: '0.85rem' }} 
                        value={kycForm.email} 
                        onChange={(e) => setKycForm({ ...kycForm, email: e.target.value })}
                      />
                      <input 
                        type="text" 
                        placeholder="PAN / Identity Number" 
                        className="form-input" 
                        required 
                        style={{ flex: 1, minWidth: '150px', padding: '6px 12px', fontSize: '0.85rem' }} 
                        value={kycForm.pan_number} 
                        onChange={(e) => setKycForm({ ...kycForm, pan_number: e.target.value })}
                      />
                      <button className="btn btn-saffron btn-sm" type="submit" disabled={kycLoading}>
                        Submit Details
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* Portfolio Stats */}
            <div className="grid-4" style={{ gap: 'var(--space-4)' }}>
              <StatCard value={myInvestments.length} label="Active Holdings" valueColor="var(--color-text-primary)" />
              <StatCard value={formatUsd(totalDeployed * 100)} label="Capital Deployed" valueColor="var(--color-teal)" />
              <StatCard value={formatUsd(totalFaceValue * 100)} label="Face Value Yield" valueColor="var(--color-saffron)" />
              <StatCard value={`+${formatUsd(expectedProfit * 100)}`} label="Projected Gains" valueColor="var(--color-green)" />
            </div>

            {/* Holdings Table */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-4)' }}>Your Active Positions</h3>
              
              {loading ? (
                <div className="skeleton" style={{ height: '150px' }} />
              ) : myInvestments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-6) 0' }}>
                  <p className="text-secondary text-ui-sm" style={{ marginBottom: 'var(--space-4)' }}>You have no open trade positions yet.</p>
                  <Link to="/marketplace" className="btn btn-primary btn-sm">Explore Marketplace</Link>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', opacity: 0.6 }}>
                      <th style={{ padding: '8px 12px' }} className="form-label">Asset / Manifest ID</th>
                      <th style={{ padding: '8px 12px' }} className="form-label">Commodity</th>
                      <th style={{ padding: '8px 12px' }} className="form-label">Face Value</th>
                      <th style={{ padding: '8px 12px' }} className="form-label">Purchase Price</th>
                      <th style={{ padding: '8px 12px' }} className="form-label">Days to Maturity</th>
                      <th style={{ padding: '8px 12px' }} className="form-label">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myInvestments.map((inv, idx) => {
                      const days = daysUntil(inv.receivable?.maturity_date);
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                          <td style={{ padding: '12px' }} className="monospace">
                            <Link to={`/receivable/${inv.receivable_id}`} style={{ color: 'var(--color-teal)', fontWeight: 600 }}>
                              #{inv.receivable_id} ({inv.receivable?.token_asset_code || 'MLREC'})
                            </Link>
                          </td>
                          <td style={{ padding: '12px' }}>{inv.receivable?.commodity}</td>
                          <td style={{ padding: '12px', fontWeight: 600 }}>{formatUsd(inv.share_cents)}</td>
                          <td style={{ padding: '12px' }}>{formatUsd(inv.payment_cents)}</td>
                          <td style={{ padding: '12px' }}>{days} Days</td>
                          <td style={{ padding: '12px' }}>
                            <span className={`badge badge-${inv.receivable?.status}`}>
                              ● {inv.receivable?.status?.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
