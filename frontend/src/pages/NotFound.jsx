import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        {/* Decorative */}
        <div style={{
          fontSize: '6rem',
          lineHeight: 1,
          marginBottom: 'var(--space-5)',
          filter: 'drop-shadow(0 0 24px rgba(232,160,32,0.4))',
        }}>
          🌊
        </div>

        <div className="section-label" style={{ marginBottom: 'var(--space-2)' }}>404 — Not Found</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', marginBottom: 'var(--space-4)', lineHeight: 1.1 }}>
          Lost at sea,{' '}
          <span className="shine">off the Malabar Coast</span>
        </h1>

        <p className="text-secondary text-ui-lg" style={{ marginBottom: 'var(--space-7)', lineHeight: 1.7 }}>
          The page you're looking for doesn't exist or has been moved.
          Even Vasco da Gama needed a guide — let us take you home.
        </p>

        <div className="flex gap-3" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            onClick={() => navigate(-1)}
            id="notfound-back-btn"
          >
            ← Go Back
          </button>
          <Link to="/" className="btn btn-primary" id="notfound-home-btn">
            Back to Home
          </Link>
          <Link to="/investor" className="btn btn-saffron" id="notfound-invest-btn">
            Browse Receivables
          </Link>
        </div>

        {/* Decorative coordinate text */}
        <div style={{
          marginTop: 'var(--space-7)',
          fontSize: '0.7rem',
          letterSpacing: '0.2em',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
        }}>
          11.2588° N · 75.7804° E · Kozhikode, Kerala
        </div>
      </div>
    </main>
  );
}
