import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReceivables } from '../hooks/useReceivables.js';
import ReceivableCard from '../components/ReceivableCard.jsx';

export default function Marketplace() {
  const { receivables, loading, error } = useReceivables({}, 10000);
  const navigate = useNavigate();
  
  const [commodityFilter, setCommodityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('newest');

  // Commodities represented in mock/real data
  const commodities = ['all', 'Pepper', 'Cardamom', 'Seafood', 'Ginger', 'Coir'];

  const filtered = receivables.filter((r) => {
    const matchCommodity = commodityFilter === 'all' || r.commodity?.toLowerCase() === commodityFilter.toLowerCase();
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    return matchCommodity && matchStatus;
  }).sort((a, b) => {
    if (sortOrder === 'newest') return b.id - a.id;
    if (sortOrder === 'yield-desc') return (b.discount_bps || 0) - (a.discount_bps || 0);
    if (sortOrder === 'value-desc') return (b.amount_usd || 0) - (a.amount_usd || 0);
    return 0;
  });

  return (
    <main className="page-content">
      <div className="container">
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div className="section-label" style={{ color: 'var(--color-saffron)' }}>Open Ledger</div>
          <h1 className="display-md" style={{ marginBottom: 'var(--space-2)' }}>
            Trade Finance <span style={{ color: 'var(--color-teal)' }}>Marketplace</span>
          </h1>
          <p className="text-secondary text-ui-md" style={{ maxWidth: '600px' }}>
            Browse and invest in fractionalized export bills verified by the Malabar trade protocol.
          </p>
        </div>

        {/* Filters Panel */}
        <div 
          className="card" 
          style={{ 
            marginBottom: 'var(--space-6)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-4)',
            alignItems: 'center',
            justifyContent: 'between'
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', flex: 1 }}>
            {/* Commodity Filter */}
            <div className="form-group" style={{ minWidth: '150px' }}>
              <label className="form-label" style={{ fontSize: '0.7rem' }}>Commodity</label>
              <select 
                className="form-select" 
                value={commodityFilter} 
                onChange={(e) => setCommodityFilter(e.target.value)}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              >
                {commodities.map((c) => (
                  <option key={c} value={c}>
                    {c === 'all' ? 'All Commodities' : c}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="form-group" style={{ minWidth: '150px' }}>
              <label className="form-label" style={{ fontSize: '0.7rem' }}>Status</label>
              <select 
                className="form-select" 
                value={statusFilter} 
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              >
                <option value="all">All States</option>
                <option value="pending">Pending Attestation</option>
                <option value="attested">Attested</option>
                <option value="active">Active (For Sale)</option>
                <option value="settled">Settled</option>
              </select>
            </div>

            {/* Sort Order */}
            <div className="form-group" style={{ minWidth: '150px' }}>
              <label className="form-label" style={{ fontSize: '0.7rem' }}>Sort By</label>
              <select 
                className="form-select" 
                value={sortOrder} 
                onChange={(e) => setSortOrder(e.target.value)}
                style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              >
                <option value="newest">Newest Listed</option>
                <option value="yield-desc">Highest Yield</option>
                <option value="value-desc">Highest Value</option>
              </select>
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            Showing <strong>{filtered.length}</strong> manifests
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="alert alert-danger" style={{ marginBottom: 'var(--space-5)' }}>
            Error fetching marketplace: {error}
          </div>
        )}

        {/* Content Grid */}
        {loading ? (
          <div className="grid-3" style={{ gap: 'var(--space-5)' }}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="skeleton" style={{ height: '240px', borderRadius: 'var(--radius-lg)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-3)' }}>📜</div>
            <h3 style={{ fontFamily: 'var(--font-display)', marginBottom: 'var(--space-2)' }}>No Manifests Found</h3>
            <p className="text-secondary text-ui-sm">Try adjusting your search criteria or register a new invoice.</p>
          </div>
        ) : (
          <div className="grid-3" style={{ gap: 'var(--space-5)' }}>
            {filtered.map((receivable) => (
              <ReceivableCard 
                key={receivable.id} 
                receivable={receivable} 
                onClick={() => navigate(`/receivable/${receivable.id}`)}
                showInvest={receivable.status === 'active'}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
