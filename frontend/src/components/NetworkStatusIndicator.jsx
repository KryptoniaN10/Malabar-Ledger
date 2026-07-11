import React from 'react';

export default function NetworkStatusIndicator() {
  const network = import.meta.env.VITE_STELLAR_NETWORK || 'testnet';
  const isTestnet = network.toLowerCase() === 'testnet';

  return (
    <div className="network-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span 
        className="network-badge-dot" 
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: isTestnet ? 'var(--color-saffron)' : 'var(--color-green)',
          display: 'inline-block'
        }} 
      />
      <span style={{ textTransform: 'capitalize', fontSize: '0.75rem', fontWeight: 600 }}>
        {network}
      </span>
    </div>
  );
}
