import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { platformApi, formatUsd } from '../stellar/client.js';
import StatCard from '../components/StatCard.jsx';
import NetworkStatusIndicator from '../components/NetworkStatusIndicator.jsx';
import VerifiedBadge from '../components/VerifiedBadge.jsx';

export default function Landing({ walletAddress, onConnect }) {
  const [liveStats, setLiveStats] = useState(null);

  useEffect(() => {
    platformApi.getStats()
      .then(setLiveStats)
      .catch(() => {});
  }, []);

  const fmtUsd = (n) => n >= 1000000
    ? `$${(n / 1000000).toFixed(1)}M`
    : n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${n}`;

  // Stellar Features
  const features = [
    { title: 'Native Asset Issuance', desc: 'Each export invoice is minted as a distinct Stellar asset with institutional authorization control.' },
    { title: 'Soroban Smart Contracts', desc: 'Escrow-backed multi-sig contract registry protects investor yields and regulates distribution.' },
    { title: 'Real World Assets (RWA)', desc: 'Direct mapping of shipping manifests to on-chain tokens backed by verified bills of lading.' },
    { title: 'Stellar Anchors (SEP-24)', desc: 'Facilitates fast, low-cost capital transfers between global currencies and digital USDC.' }
  ];

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Hero Section */}
      <section 
        style={{
          background: 'var(--gradient-hero)',
          padding: 'var(--space-9) 0 var(--space-8)',
          borderBottom: '1px solid var(--color-border)',
          textAlign: 'center',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div className="container-narrow" style={{ position: 'relative', zIndex: 2 }}>
          <div 
            className="form-label" 
            style={{ 
              color: 'var(--color-saffron)', 
              letterSpacing: '0.15em', 
              fontSize: '0.75rem',
              marginBottom: 'var(--space-3)'
            }}
          >
            🌿 Trade Finance Protocol of the Malabar Coast
          </div>
          
          <h1 
            className="display-xl" 
            style={{ 
              marginBottom: 'var(--space-4)', 
              color: 'var(--color-text-primary)' 
            }}
          >
            Same-Day Working Capital for <span style={{ color: 'var(--color-teal)' }}>Kerala's Exporters</span>
          </h1>
          
          <p 
            className="text-secondary text-ui-lg" 
            style={{ 
              maxWidth: '650px', 
              margin: '0 auto var(--space-5)', 
              lineHeight: 1.7 
            }}
          >
            Tokenize and fractionalize export receivables. Sell invoices to global liquidity partners instantly.
            Backed by physical shipping bills. Settled securely on the Stellar network.
          </p>

          <div 
            className="flex justify-center gap-3" 
            style={{ 
              flexWrap: 'wrap',
              marginBottom: 'var(--space-6)' 
            }}
          >
            <Link to="/marketplace" className="btn btn-primary btn-lg">
              Explore Receivables
            </Link>
            <Link to="/exporter" className="btn btn-outline btn-lg">
              For Exporters
            </Link>
          </div>
        </div>
      </section>

      {/* Trust Band / Live Stats (Dark Ink Background for Contrast Rhythm) */}
      <section 
        style={{
          background: 'var(--color-bg-ink-dark)',
          color: 'var(--color-text-ink-light)',
          padding: 'var(--space-6) 0',
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <div className="container">
          <div className="grid-4" style={{ gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-saffron-light)', lineHeight: 1 }}>
                {liveStats ? String(liveStats.total_receivables || 0) : '—'}
              </div>
              <span className="form-label" style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                RECEIVABLES TOKENIZED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-saffron-light)', lineHeight: 1 }}>
                {liveStats ? fmtUsd(liveStats.total_volume_usd || 0) : '—'}
              </div>
              <span className="form-label" style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                TOTAL LIQUIDITY VOLUME
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-saffron-light)', lineHeight: 1 }}>
                {liveStats ? String(liveStats.exporter_count || 0) : '—'}
              </div>
              <span className="form-label" style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                EXPORTERS VERIFIED
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--color-saffron-light)', lineHeight: 1 }}>
                {liveStats ? String(liveStats.investor_count || 0) : '—'}
              </div>
              <span className="form-label" style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.1em' }}>
                LIQUIDITY INVESTORS
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Protocol Architecture */}
      <section style={{ padding: 'var(--space-8) 0', background: 'var(--color-bg-base)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
            <div className="section-label" style={{ color: 'var(--color-saffron)' }}>Protocol Features</div>
            <h2 className="display-md" style={{ marginBottom: 'var(--space-2)' }}>
              Built on Stellar & Soroban
            </h2>
            <p className="text-secondary text-ui-sm" style={{ maxWidth: '500px', margin: '0 auto' }}>
              Replacing traditional trade friction with instant on-chain settlement, absolute document transparency, and compliance-first controls.
            </p>
          </div>

          <div className="grid-2" style={{ gap: 'var(--space-5)' }}>
            {features.map((feat) => (
              <div key={feat.title} className="card" style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'start' }}>
                <span style={{ fontSize: '1.5rem' }}>✨</span>
                <div>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: 'var(--space-1)' }}>{feat.title}</h4>
                  <p className="text-ui-xs text-secondary" style={{ lineHeight: 1.6 }}>{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
