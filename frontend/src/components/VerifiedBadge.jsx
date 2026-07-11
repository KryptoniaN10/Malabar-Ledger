import React from 'react';

export default function VerifiedBadge() {
  return (
    <span 
      className="badge" 
      style={{
        background: 'rgba(92, 125, 100, 0.08)',
        color: 'var(--color-green)',
        borderColor: 'rgba(92, 125, 100, 0.2)',
        borderStyle: 'solid',
        borderWidth: '1px',
        fontSize: '0.68rem',
        padding: '3px 8px',
        borderRadius: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }}
    >
      🛡️ Verified
    </span>
  );
}
