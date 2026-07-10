import React from 'react';

export default function ProgressBar({ progress }) {
  const roundedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  return (
    <div style={{ width: '100%' }}>
      <div 
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'var(--color-bg-elevated)',
          borderRadius: 'var(--radius-pill)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)'
        }}
      >
        <div 
          style={{
            width: `${roundedProgress}%`,
            height: '100%',
            backgroundColor: 'var(--color-saffron)',
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--transition-slow)'
          }}
        />
      </div>
      <div className="flex justify-between items-center" style={{ marginTop: 'var(--space-2)' }}>
        <span className="text-ui-xs text-muted" style={{ fontWeight: 500 }}>Funding Progress</span>
        <span className="text-ui-xs monospace text-saffron" style={{ fontWeight: 600 }}>{roundedProgress}%</span>
      </div>
    </div>
  );
}
