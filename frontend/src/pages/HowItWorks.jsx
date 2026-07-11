import React from 'react';

export default function HowItWorks() {
  const steps = [
    {
      num: 'I.',
      title: 'Upload & Digitization',
      desc: 'The exporter uploads shipping documents (Bill of Lading, Invoice) through the portal. The documents are cryptographically SHA-256 hashed and pinned to IPFS. The hash acts as an immutable proof of shipment.'
    },
    {
      num: 'II.',
      title: '2-of-3 Attestation',
      desc: 'Independent trade entities (Logistics partner, Export Promotion Council, NBFC) inspect the digital manifest. Once 2 of the 3 verify the authenticity, the Soroban registry contract mints a unique receivable compliance-gated token.'
    },
    {
      num: 'III.',
      title: 'Fractional Funding',
      desc: 'The exporter lists the receivable at a discount (e.g., 8% yield). Verified investors purchase fractional shares of the invoice using USDC. The purchase capital is escrowed and then paid out to the exporter, providing instant working capital.'
    },
    {
      num: 'IV.',
      title: 'Oracle Settlement',
      desc: 'Upon invoice maturity (60-90 days), the importer pays. An automated bank oracle confirms the wire transfer on-chain. The escrow contract distributes the importer payment pro-rata to all investors holding the fractional tokens.'
    }
  ];

  return (
    <main className="page-content">
      <div className="container-narrow">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-7)' }}>
          <div className="section-label" style={{ color: 'var(--color-saffron)' }}>Operational Protocol</div>
          <h1 className="display-lg" style={{ marginBottom: 'var(--space-3)' }}>
            The Mechanics of <span style={{ color: 'var(--color-teal)' }}>Malabar Ledger</span>
          </h1>
          <p className="text-secondary text-ui-lg">
            A secure bridge between real-world physical trade lanes and digital liquidity.
          </p>
        </div>

        {/* Historic Context Callout */}
        <div 
          className="card" 
          style={{ 
            marginBottom: 'var(--space-7)', 
            borderStyle: 'solid', 
            borderWidth: '1px', 
            borderColor: 'var(--color-border-gold)',
            background: 'var(--color-bg-elevated)',
            padding: 'var(--space-6)'
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'start' }}>
            <span style={{ fontSize: '2rem' }}>⚓</span>
            <div>
              <h4 style={{ color: 'var(--color-saffron)', marginBottom: 'var(--space-2)' }}>A Legacy of Trust</h4>
              <p className="text-ui-sm text-secondary" style={{ lineHeight: 1.6 }}>
                For centuries, the ports of the Malabar Coast connected local merchants to global markets using physical manifests and handwritten ledger books. Malabar Ledger digitizes this exact heritage of trust, replacing ink manifests with on-chain Soroban registry records and escrow accounts.
              </p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {steps.map((s, index) => (
            <div 
              key={s.num} 
              className="card" 
              style={{ 
                display: 'flex', 
                gap: 'var(--space-5)', 
                alignItems: 'start',
                position: 'relative'
              }}
            >
              <div 
                style={{ 
                  fontFamily: 'var(--font-display)', 
                  fontSize: '2.5rem', 
                  fontWeight: 700, 
                  color: 'var(--color-saffron)', 
                  lineHeight: 1,
                  opacity: 0.8
                }}
              >
                {s.num}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: 'var(--space-2)' }}>{s.title}</h3>
                <p className="text-ui-sm text-secondary" style={{ lineHeight: 1.7 }}>
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
