import React from 'react';

export default function StatCard({ value, label, valueColor = 'var(--color-teal)' }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div 
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '2.5rem',
          fontWeight: 700,
          color: valueColor,
          lineHeight: 1
        }}
      >
        {value}
      </div>
      <div 
        className="form-label" 
        style={{ 
          fontSize: '0.72rem', 
          letterSpacing: '0.12em', 
          color: 'var(--color-text-muted)',
          margin: 0
        }}
      >
        {label}
      </div>
    </div>
  );
}
