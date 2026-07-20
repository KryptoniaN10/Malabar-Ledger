import React, { useState, useEffect, useCallback } from 'react';
import { receivablesApi, authApi, oracleApi, formatUsd, listReceivableWithFreighter } from '../stellar/client.js';

import { StatusBadge } from '../components/ReceivableCard.jsx';
import { AttestationMini } from '../components/ReceivableCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';

// ── Admin / Oracle Control Panel ──────────────────────────────
// This panel lets judges and demo admins:
//  1. Approve KYC sessions
//  2. Attest pending receivables
//  3. Confirm importer payment (oracle role)
//  4. Trigger pro-rata distribution
//  5. Execute emergency clawback

export default function AdminPanel({ walletAddress }) {
  const [tab, setTab] = useState('receivables');
  const [receivables, setReceivables] = useState([]);
  const [kycSessions, setKycSessions] = useState([]);
  const [oracleEvents, setOracleEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [actionResults, setActionResults] = useState({});
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async (showSkeletons = false) => {
    if (showSkeletons) setLoading(true);
    const [recs, sessions, events] = await Promise.all([
      receivablesApi.list().catch(() => []),
      authApi.listSessions().catch(() => []),
      oracleApi.events().catch(() => []),
    ]);
    setReceivables(recs);
    setKycSessions(sessions);
    setOracleEvents(events);
    setLoading(false);
  }, []);

  // Initial load showing skeletons
  useEffect(() => {
    load(true);
  }, [load]);

  // Silent auto-refresh every 8s (no skeletons to prevent flicker)
  useEffect(() => {
    const interval = setInterval(() => load(false), 8000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleResetDemo() {
    if (!window.confirm('Reset demo data? This will wipe all current receivables and re-seed 5 demo receivables.')) return;
    setResetting(true);
    try {
      await receivablesApi.resetDemo();
      await load(true);
    } catch (err) {
      alert(`Reset failed: ${err.message}`);
    }
    setResetting(false);
  }

  async function handleClearAll() {
    if (!window.confirm('Wipe all database records? This will delete all receivables, KYC sessions, investments, and oracle logs, leaving the application completely empty.')) return;
    setResetting(true);
    try {
      await receivablesApi.resetDemo({ clear_only: true });
      await load(true);
    } catch (err) {
      alert(`Clear failed: ${err.message}`);
    }
    setResetting(false);
  }

  async function runAction(key, fn) {
    setActionLoading((s) => ({ ...s, [key]: true }));
    setActionResults((s) => ({ ...s, [key]: null }));
    try {
      const result = await fn();
      setActionResults((s) => ({ ...s, [key]: { ok: true, data: result } }));
      await load();
    } catch (err) {
      setActionResults((s) => ({ ...s, [key]: { ok: false, error: err.message } }));
    }
    setActionLoading((s) => ({ ...s, [key]: false }));
  }

  const TABS = [
    { id: 'receivables', label: '📋 Receivables' },
    { id: 'kyc', label: '🔐 KYC Sessions' },
    { id: 'oracle', label: '⚡ Oracle Events' },
  ];

  return (
    <main className="page-content">
      <div className="container">
        {/* ── Header ──────────────────────────────────────────── */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="flex items-center gap-3" style={{ marginBottom: 'var(--space-2)' }}>
            <div className="section-label" style={{ margin: 0, color: 'var(--color-saffron)' }}>Control Panel</div>
            <div className="badge badge-clawback" style={{ fontSize: '0.65rem' }}>
              ADMIN / ORACLE
            </div>
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>
            Demo Control{' '}
            <span style={{ color: 'var(--color-teal)' }}>Panel</span>
          </h1>
          <p className="text-secondary text-ui-md">
            Attest receivables, approve KYC, confirm payments, and trigger pro-rata distribution.
            All actions are on-chain (or demo mode without keys).
          </p>
          <div className="flex gap-2" style={{ marginTop: 'var(--space-4)' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleResetDemo}
              disabled={resetting}
              id="admin-reset-demo-btn"
              style={{ borderColor: 'var(--color-saffron)', color: 'var(--color-saffron)' }}
            >
              {resetting ? '⏳ Resetting...' : '🔄 Reset Demo Data'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleClearAll}
              disabled={resetting}
              id="admin-clear-all-btn"
              style={{ borderColor: '#f08080', color: '#f08080' }}
            >
              {resetting ? '⏳ Clearing...' : '🗑️ Clear All Data'}
            </button>
          </div>
        </div>

        {/* ── Stats row ────────────────────────────────────────── */}
        <div className="grid-4" style={{ marginBottom: 'var(--space-6)' }}>
          {[
            { label: 'Total Receivables', value: receivables.length, color: 'var(--color-teal-light)' },
            { label: 'Pending Attestation', value: receivables.filter((r) => r.status === 'pending').length, color: 'var(--color-saffron)' },
            { label: 'Active for Sale', value: receivables.filter((r) => r.status === 'active').length, color: 'var(--color-green-light)' },
            { label: 'Awaiting Payout', value: receivables.filter((r) => r.status === 'settled_pending').length, color: '#8fa8ff' },
          ].map((s) => (
            <div key={s.label} className="card stat-card">
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Tab nav ──────────────────────────────────────────── */}
        <div className="flex gap-2" style={{ marginBottom: 'var(--space-5)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(t.id)}
              id={`admin-tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => load(false)} id="admin-refresh-btn">
            ↻ Refresh
          </button>
        </div>

        <div className="grid-2" style={{ gap: 'var(--space-6)', alignItems: 'start' }}>
          {/* ── Main content ─────────────────────────────────────── */}
          <div style={{ gridColumn: '1 / -1' }}>
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
              </div>
            ) : (
              <>
                {/* ── Receivables Tab ─────────────────────────────── */}
                {tab === 'receivables' && (
                  <div className="flex flex-col gap-4 animate-fade-in">
                    {receivables.length === 0 ? (
                      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
                        <div className="text-secondary">No receivables registered yet</div>
                      </div>
                    ) : receivables.map((rec) => (
                      <AdminReceivableRow
                        key={rec.id}
                        rec={rec}
                        walletAddress={walletAddress}
                        onAttest={(role) => runAction(`attest-${rec.id}-${role}`, () =>
                          receivablesApi.attest(rec.id, {
                            attestor_address: walletAddress || `DEMO_ATTESTOR_${role.toUpperCase()}`,
                            attestor_role: role,
                          })
                        )}
                        onListSale={(discountBps) => runAction(`list-${rec.id}`, async () => {
                          let txHash = null;
                          if (walletAddress && walletAddress === rec.exporter_address) {
                            const signed = await listReceivableWithFreighter({
                              exporterAddress: walletAddress,
                              receivableId: rec.id,
                              faceValueUsd: rec.amount_usd,
                              discountBps,
                            });
                            txHash = signed.hash;
                          }

                          return receivablesApi.listSale(rec.id, {
                            discount_bps: discountBps,
                            exporter_address: walletAddress,
                            tx_hash: txHash,
                          });
                        })}
                        onConfirmPayment={() => runAction(`confirm-${rec.id}`, () =>
                          oracleApi.confirmPayment(rec.id, {
                            confirmed_amount_usd: rec.amount_usd,
                            proof: `DEMO-SWIFT-MT103-${Date.now()}`,
                            triggered_by: walletAddress || 'demo_oracle',
                          })
                        )}
                        onDistribute={() => runAction(`distribute-${rec.id}`, () =>
                          oracleApi.distribute(rec.id, {
                            triggered_by: walletAddress || 'demo_oracle',
                          })
                        )}
                        onClawback={(reason) => runAction(`clawback-${rec.id}`, () =>
                          oracleApi.clawback(rec.id, { reason })
                        )}
                        actionLoading={actionLoading}
                        actionResults={actionResults}
                      />
                    ))}
                  </div>
                )}

                {/* ── KYC Tab ─────────────────────────────────────── */}
                {tab === 'kyc' && (
                  <div className="flex flex-col gap-4 animate-fade-in">
                    {kycSessions.length === 0 ? (
                      <div className="card" style={{ textAlign: 'center', padding: 'var(--space-7)' }}>
                        <div className="text-secondary">No KYC sessions yet</div>
                      </div>
                    ) : kycSessions.map((session) => (
                      <div key={session.id} className="card" style={{ padding: 'var(--space-4)' }}>
                        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{session.name || 'Unknown'}</div>
                            <div className="text-ui-xs text-muted">{session.wallet_address}</div>
                            <div className="text-ui-xs text-muted">{session.email}</div>
                          </div>
                          <div className="flex flex-col items-center gap-2">
                            <span className={`badge ${session.status === 'approved' ? 'badge-attested' : session.status === 'rejected' ? 'badge-clawback' : 'badge-pending'}`}>
                              {session.status}
                            </span>
                          </div>
                        </div>

                        {session.status === 'pending' && (
                          <div className="flex gap-2">
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => runAction(`kyc-approve-${session.id}`, () =>
                                authApi.approveKyc(session.id)
                              )}
                              disabled={actionLoading[`kyc-approve-${session.id}`]}
                              id={`kyc-approve-${session.id}`}
                            >
                              {actionLoading[`kyc-approve-${session.id}`] ? '...' : '✓ Approve KYC'}
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => runAction(`kyc-reject-${session.id}`, () =>
                                authApi.rejectKyc(session.id, { reason: 'Demo rejection' })
                              )}
                              disabled={actionLoading[`kyc-reject-${session.id}`]}
                              id={`kyc-reject-${session.id}`}
                            >
                              Reject
                            </button>
                          </div>
                        )}

                        {actionResults[`kyc-approve-${session.id}`] && (
                          <ActionFeedback result={actionResults[`kyc-approve-${session.id}`]} />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Oracle Events Tab ────────────────────────────── */}
                {tab === 'oracle' && (
                  <div className="animate-fade-in">
                    <LiveFeed walletAddress={walletAddress} />
                    <div className="flex flex-col gap-3" style={{ marginTop: 'var(--space-5)' }}>
                      {oracleEvents.length === 0 && (
                        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-5)' }}>
                          <div className="text-muted text-ui-sm">No oracle events yet. Run the demo flow!</div>
                        </div>
                      )}
                      {oracleEvents.map((event) => (
                        <div key={event.id} className="card" style={{ padding: 'var(--space-3)' }}>
                          <div className="flex items-center justify-between">
                            <div style={{ flex: 1 }}>
                              <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                                <span className="text-ui-sm" style={{ fontWeight: 700 }}>
                                  {event.event_type}
                                </span>
                                <span className="badge badge-pending" style={{ fontSize: '0.6rem' }}>
                                  Receivable #{event.receivable_id}
                                </span>
                              </div>
                              {event.amount_cents && (
                                <div className="text-ui-xs text-muted">
                                  Amount: {formatUsd(event.amount_cents)}
                                </div>
                              )}
                              {event.proof && (
                                <div className="monospace text-ui-xs text-muted truncate" style={{ maxWidth: 320 }}>
                                  {event.proof}
                                </div>
                              )}
                              {/* Stellar Expert link if we have a real tx hash */}
                              {event.proof && event.proof.length === 64 && !event.proof.startsWith('demo') && (
                                <a
                                  href={`https://stellar.expert/explorer/testnet/tx/${event.proof}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-ui-xs"
                                  style={{ color: 'var(--color-teal-light)', textDecoration: 'underline' }}
                                >
                                  View on Stellar Expert ↗
                                </a>
                              )}
                            </div>
                            <div className="text-ui-xs text-muted" style={{ marginLeft: 'var(--space-3)', flexShrink: 0 }}>
                              {new Date(event.occurred_at).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ── Admin Receivable Row ──────────────────────────────────────
function AdminReceivableRow({
  rec, walletAddress,
  onAttest, onListSale, onConfirmPayment, onDistribute, onClawback,
  actionLoading, actionResults,
}) {
  const [discountBps, setDiscountBps] = useState(500);
  const [clawbackReason, setClawbackReason] = useState('');
  const [showClawback, setShowClawback] = useState(false);

  const ATTESTOR_ROLES = ['logistics', 'export_council', 'nbfc'];
  const existingRoles = (rec.attestations || []).map((a) => a.attestor_role);
  const remainingRoles = ATTESTOR_ROLES.filter((r) => !existingRoles.includes(r));
  const canAttest = rec.status === 'pending' && remainingRoles.length > 0;

  return (
    <div className="card" style={{ padding: 'var(--space-4)' }}>
      {/* Row header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
            <span style={{ fontWeight: 700 }}>#{rec.id} {rec.commodity}</span>
            <StatusBadge status={rec.status} />
          </div>
          <div className="text-ui-xs text-muted">
            {rec.exporter_name || rec.exporter_address} → {rec.buyer_name}, {rec.buyer_country}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: 'var(--color-teal-light)' }}>
            {formatUsd(rec.amount_usd * 100)}
          </div>
          <div className="text-ui-xs text-muted">Due: {rec.maturity_date}</div>
        </div>
      </div>

      {/* Attestation tracker */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <AttestationMini count={rec.attestation_count || 0} required={2} />
        {(rec.attestations || []).map((a) => (
          <div key={a.id} className="text-ui-xs text-muted" style={{ marginTop: 4 }}>
            ✓ {a.attestor_role} — {a.attestor_address?.slice(0, 8)}…
          </div>
        ))}
      </div>

      {/* Action buttons by status */}
      <div className="flex flex-col gap-3">
        {/* PENDING: Attest buttons */}
        {canAttest && (
          <div>
            <div className="section-label">Attest as:</div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {remainingRoles.map((role) => {
                const key = `attest-${rec.id}-${role}`;
                return (
                  <button
                    key={role}
                    className="btn btn-outline btn-sm"
                    onClick={() => onAttest(role)}
                    disabled={actionLoading[key]}
                    id={`attest-${rec.id}-${role}-btn`}
                  >
                    {actionLoading[key] ? '...' : `✓ ${role.replace('_', ' ')}`}
                  </button>
                );
              })}
            </div>
            {ATTESTOR_ROLES.filter((r) => existingRoles.includes(r)).map((role) => (
              <span key={role} className="text-ui-xs text-green" style={{ marginRight: 8 }}>
                ✓ {role} signed
              </span>
            ))}
          </div>
        )}

        {/* ATTESTED: List for sale */}
        {rec.status === 'attested' && (
          <div>
            <div className="section-label">List for Fractional Sale</div>
            <div className="flex items-center gap-3">
              <div style={{ flex: 1 }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                  <span className="text-ui-xs text-muted">Discount rate</span>
                  <span className="text-accent text-ui-sm">{(discountBps / 100).toFixed(1)}%</span>
                </div>
                <input type="range" min={100} max={2000} step={50}
                  value={discountBps} onChange={(e) => setDiscountBps(Number(e.target.value))}
                  id={`discount-slider-${rec.id}`}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onListSale(discountBps)}
                disabled={actionLoading[`list-${rec.id}`]}
                id={`list-sale-${rec.id}-btn`}
              >
                {actionLoading[`list-${rec.id}`] ? '...' : 'List →'}
              </button>
            </div>
          </div>
        )}

        {/* ACTIVE: Confirm payment (judge-triggerable oracle button) */}
        {rec.status === 'active' && (
          <div>
            <div className="section-label">Oracle Actions</div>
            <div className="alert alert-info" style={{ marginBottom: 'var(--space-3)', padding: '8px 12px' }}>
              <span className="text-ui-xs">
                In production: triggered by SWIFT/SEPA confirmation feed. For demo: click below.
              </span>
            </div>
            <button
              className="btn btn-saffron"
              onClick={onConfirmPayment}
              disabled={actionLoading[`confirm-${rec.id}`]}
              id={`confirm-payment-${rec.id}-btn`}
              style={{ width: '100%' }}
            >
              {actionLoading[`confirm-${rec.id}`]
                ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Confirming...</>
                : '💸 Confirm Importer Payment'}
            </button>
          </div>
        )}

        {/* SETTLED_PENDING: Distribute */}
        {rec.status === 'settled_pending' && (
          <div>
            <div className="alert" style={{
              background: 'rgba(143,168,255,0.1)',
              border: '1px solid rgba(143,168,255,0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              marginBottom: 'var(--space-3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="spinner" style={{ width: 14, height: 14 }} />
                <span className="text-ui-xs" style={{ color: '#8fa8ff' }}>
                  Payment confirmed — awaiting pro-rata distribution to {(rec.investments || []).length} investor(s)
                </span>
              </div>
            </div>
            <button
              className="btn btn-primary"
              onClick={onDistribute}
              disabled={actionLoading[`distribute-${rec.id}`]}
              id={`distribute-${rec.id}-btn`}
              style={{ width: '100%' }}
            >
              {actionLoading[`distribute-${rec.id}`]
                ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Distributing...</>
                : '🎉 Distribute Pro-rata Payout'}
            </button>
          </div>
        )}

        {/* Emergency clawback (any non-settled state) */}
        {!['settled', 'clawback'].includes(rec.status) && (
          <div>
            {!showClawback ? (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => setShowClawback(true)}
                id={`clawback-toggle-${rec.id}`}
              >
                ⚠ Emergency Clawback
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                <input
                  className="form-input"
                  placeholder="Clawback reason (fraud, dispute...)"
                  value={clawbackReason}
                  onChange={(e) => setClawbackReason(e.target.value)}
                  id={`clawback-reason-${rec.id}`}
                />
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => { onClawback(clawbackReason); setShowClawback(false); }}
                  id={`clawback-confirm-${rec.id}-btn`}
                >
                  Confirm
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowClawback(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action feedback */}
        {Object.entries(actionResults)
          .filter(([key]) => key.includes(`-${rec.id}`))
          .map(([key, result]) => result && (
            <ActionFeedback key={key} result={result} />
          ))
        }
      </div>
    </div>
  );
}

function ActionFeedback({ result }) {
  if (!result) return null;
  const url = result.data?.stellar_expert_url;
  const isAlreadyAttestedError = !result.ok && result.error === 'Already attested';
  return (
    <div className={`alert ${result.ok ? 'alert-success' : 'alert-error'} animate-fade-in`}
      style={{ padding: '8px 12px' }}>
      <div>
        <div className="text-ui-xs">
          {result.ok ? `✓ ${result.data?.message || 'Success'}` : `✗ ${result.error}`}
        </div>
        {isAlreadyAttestedError && (
          <div className="text-ui-xs text-muted" style={{ marginTop: 6, lineHeight: 1.4, color: 'var(--color-saffron)' }}>
            💡 <strong>Anti-Collusion Security Rule:</strong> A single Stellar wallet address cannot sign for multiple attestation roles on the same receivable. To sign as another role for the demo, click the <strong>⏏</strong> (disconnect) button in the top-right navbar to use fallback demo addresses, or switch accounts in Freighter.
          </div>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ui-xs"
            style={{ color: 'var(--color-teal-light)', textDecoration: 'underline', display: 'block', marginTop: 4 }}
          >
            View on Stellar Expert ↗
          </a>
        )}
      </div>
    </div>
  );
}
