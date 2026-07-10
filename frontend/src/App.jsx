import React, { useState, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import ExporterDashboard from './pages/ExporterDashboard.jsx';
import InvestorDashboard from './pages/InvestorDashboard.jsx';
import AdminPanel from './pages/AdminPanel.jsx';
import NotFound from './pages/NotFound.jsx';
import Marketplace from './pages/Marketplace.jsx';
import ReceivableDetail from './pages/ReceivableDetail.jsx';
import HowItWorks from './pages/HowItWorks.jsx';
import Navbar from './components/Navbar.jsx';
import Footer from './components/Footer.jsx';
import { connectFreighter, getFreighterPublicKey } from './stellar/client.js';

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)', color: 'var(--color-text-primary)' }}>
      {/* Navbar */}
      <Navbar 
        walletAddress={walletAddress}
        connecting={connecting}
        onConnect={handleConnect}
        onDisconnect={() => setWalletAddress(null)}
      />

      {/* Main Content Area */}
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing walletAddress={walletAddress} onConnect={handleConnect} />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/receivable/:id" element={<ReceivableDetail walletAddress={walletAddress} onConnect={handleConnect} />} />
          <Route path="/dashboard" element={<InvestorDashboard walletAddress={walletAddress} onConnect={handleConnect} />} />
          <Route path="/exporter" element={<ExporterDashboard walletAddress={walletAddress} onConnect={handleConnect} />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/admin" element={<AdminPanel walletAddress={walletAddress} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      {/* Footer */}
      <Footer />

      {/* Mobile Wallet Guide Modal */}
      {showMobileModal && (
        <div className="modal-backdrop" style={{ zIndex: 1000 }} onClick={() => setShowMobileModal(false)}>
          <div className="modal" style={{ maxWidth: 440, border: '1px solid var(--color-saffron)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>📱 Mobile Wallet Guide</h3>
              <button className="modal-close" onClick={() => setShowMobileModal(false)}>✕</button>
            </div>
            
            <p className="text-ui-xs text-secondary" style={{ marginBottom: 'var(--space-4)', lineHeight: 1.6 }}>
              On mobile devices, Freighter is available as a dedicated application rather than a browser extension. 
              To connect and sign transactions:
            </p>

            <div style={{
              background: 'var(--color-bg-elevated)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-4)',
              marginBottom: 'var(--space-4)',
              border: '1px solid var(--color-border)'
            }}>
              <ol className="text-ui-xs text-secondary" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
                <li>Copy the current website URL:<br />
                  <span className="monospace text-accent" style={{ fontSize: '0.8rem', wordBreak: 'break-all', fontWeight: 600 }}>
                    {window.location.origin}/
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
                  navigator.clipboard.writeText(window.location.origin + "/").catch(() => {});
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
    </div>
  );
}
