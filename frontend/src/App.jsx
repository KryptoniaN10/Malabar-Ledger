import React, { useState, useEffect } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import ExporterDashboard from './pages/ExporterDashboard.jsx';
import InvestorDashboard from './pages/InvestorDashboard.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import NotFound from './pages/NotFound.jsx';
import { connectFreighter, getFreighterPublicKey, formatAddress } from './stellar/client.js';

export default function App() {
  const [walletAddress, setWalletAddress] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [showMobileModal, setShowMobileModal] = useState(false);
  const location = useLocation();

  // Restore wallet on mount
  useEffect(() => {
    getFreighterPublicKey().then(setWalletAddress);
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const address = await connectFreighter();
      if (address) {
        setWalletAddress(address);
      } else {
        setShowMobileModal(true);
      }
    } catch (err) {
      console.error('Wallet connect error', err);
    }
    setConnecting(false);
  }

  const isLanding = location.pathname === '/';

  return (
    <>
      {/* ── Navigation ──────────────────────────────────────── */}
      <nav className="navbar">
        <div className="navbar-inner">
          <NavLink to="/" className="navbar-logo">
            <div className="navbar-logo-mark">M</div>
            <span className="navbar-logo-text">
              Malabar <span>Ledger</span>
            </span>
          </NavLink>

          <ul className="navbar-links">
            <li>
              <NavLink
                to="/exporter"
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                Exporter
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/investor"
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                Invest
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/admin"
                className={({ isActive }) => isActive ? 'active' : ''}
              >
                Admin
              </NavLink>
            </li>
          </ul>

          <div className="flex items-center gap-3">
            <div className="network-badge">
              <div className="network-badge-dot" />
              Testnet
            </div>

            {walletAddress ? (
              <div className="flex items-center gap-2">
                <div
                  className="btn btn-outline btn-sm"
                  title={walletAddress}
                  style={{ cursor: 'default' }}
                >
                  {formatAddress(walletAddress, 4)}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setWalletAddress(null)}
                  title="Disconnect wallet"
                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                >
                  ⏏
                </button>
              </div>
            ) : (
              <button
                id="connect-wallet-btn"
                className="btn btn-primary btn-sm"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <><div className="spinner" style={{ width: 14, height: 14 }} /> Connecting</>
                ) : (
                  'Connect Wallet'
                )}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ── Routes ──────────────────────────────────────────── */}
      <Routes>
        <Route path="/" element={<Landing walletAddress={walletAddress} onConnect={handleConnect} />} />
        <Route path="/exporter" element={<ExporterDashboard walletAddress={walletAddress} onConnect={handleConnect} />} />
        <Route path="/investor" element={<InvestorDashboard walletAddress={walletAddress} onConnect={handleConnect} />} />
        <Route path="/admin" element={<AdminPanel walletAddress={walletAddress} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {/* ── Mobile Wallet Guide Modal ───────────────────────── */}
      {showMobileModal && (
        <div className="modal-overlay animate-fade-in" style={{ zIndex: 1000 }}>
          <div className="modal-card animate-scale-in" style={{ maxWidth: 440, border: '1px solid var(--color-saffron)' }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>📱 Mobile Wallet Guide</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowMobileModal(false)}>✕</button>
            </div>
            
            <p className="text-ui-sm text-secondary" style={{ marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
              On mobile devices, Freighter is available as a dedicated application rather than a browser extension. 
              To connect and sign transactions:
            </p>

            <div style={{
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
            }}>
              <ol className="text-ui-sm" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
                <li>Copy the current website URL:<br />
                  <span className="monospace text-accent" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
                    http://10.203.224.197:5173/
                  </span>
                </li>
                <li>Open the <strong>Freighter Mobile App</strong> on your phone.</li>
                <li>Go to the <strong>Browser Tab</strong> (compass icon) inside Freighter.</li>
                <li>Paste the URL and open the site.</li>
                <li>Click <strong>Connect Wallet</strong> to connect natively!</li>
              </ol>
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-primary btn-full btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText("http://10.203.224.197:5173/").catch(() => {});
                  alert("URL copied!");
                }}
              >
                📋 Copy Link
              </button>
              <a
                href="https://www.freighter.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-full btn-sm"
                style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Get Freighter App ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
