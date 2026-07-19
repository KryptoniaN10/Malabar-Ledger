import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import NetworkStatusIndicator from './NetworkStatusIndicator.jsx';
import { formatAddress } from '../stellar/client.js';

export default function Navbar({ walletAddress, userRole, connecting, onConnect, onDisconnectWallet, onLogout }) {
  const location = useLocation();
  const isLandingPage = location.pathname === '/';
  const isMarketplaceFromHome = (location.pathname === '/marketplace' || location.pathname.startsWith('/receivable/')) && location.state?.fromHome;

  return (
    <nav className="navbar" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: 'var(--nav-height)',
      background: 'var(--color-bg-glass)',
      borderBottom: '1px solid var(--color-border)',
      zIndex: 100,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center'
    }}>
      <div className="container" style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        {/* Logo */}
        <div className="navbar-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'default' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 20L12 4L19 20" stroke="var(--color-teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 13C9 13 10.5 10.5 12 13C13.5 15.5 15 13 15 13" stroke="var(--color-saffron)" strokeWidth="2" strokeLinecap="round" />
            <line x1="12" y1="4" x2="12" y2="20" stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 2" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            ALETHEIA
          </span>
        </div>

        {/* Links */}
        <ul className="navbar-links" style={{
          display: 'flex',
          gap: 'var(--space-4)',
          listStyle: 'none',
          margin: 0,
          padding: 0
        }}>
          {(!walletAddress || isMarketplaceFromHome) && (
            <li>
              <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''} end>
                Home
              </NavLink>
            </li>
          )}
          {!isMarketplaceFromHome && !isLandingPage && walletAddress && userRole === 'investor' && (
            <>
              <li>
                <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
                  Investor Dashboard
                </NavLink>
              </li>
              <li>
                <NavLink to="/wallet" className={({ isActive }) => isActive ? 'active' : ''}>
                  Stellar Wallet
                </NavLink>
              </li>
            </>
          )}
          {!isMarketplaceFromHome && !isLandingPage && walletAddress && userRole === 'exporter' && (
            <>
              <li>
                <NavLink to="/exporter" className={({ isActive }) => isActive ? 'active' : ''}>
                  Exporter Portal
                </NavLink>
              </li>
              <li>
                <NavLink to="/wallet" className={({ isActive }) => isActive ? 'active' : ''}>
                  Stellar Wallet
                </NavLink>
              </li>
            </>
          )}
          {!isMarketplaceFromHome && (isLandingPage || !walletAddress) && (
            <li>
              <NavLink to="/how-it-works" className={({ isActive }) => isActive ? 'active' : ''}>
                How It Works
              </NavLink>
            </li>
          )}
          {!isMarketplaceFromHome && !isLandingPage && userRole === 'admin' && (
            <li>
              <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
                Admin
              </NavLink>
            </li>
          )}
        </ul>

        {/* Actions */}
        {!isLandingPage && !isMarketplaceFromHome && walletAddress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <NetworkStatusIndicator />
            {/* Connected Wallet Address Pill */}
            <div 
              style={{ 
                fontFamily: 'monospace', 
                fontWeight: 700, 
                color: 'var(--color-teal)', 
                border: '1px solid var(--color-teal)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: '0.85rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                background: '#FFFFFF'
              }}
              title={walletAddress}
            >
              {formatAddress(walletAddress, 4)}
            </div>

            {/* Disconnect Wallet / Link Freighter Button */}
            {!(walletAddress.startsWith('GDEMO') || walletAddress.startsWith('USER_')) ? (
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={onDisconnectWallet}
                style={{ 
                  border: '1px solid var(--color-border)', 
                  color: 'var(--color-text-secondary)', 
                  background: '#FFFFFF',
                  fontWeight: 600,
                  padding: '7px 14px',
                  fontSize: '0.8rem'
                }}
              >
                Disconnect Wallet
              </button>
            ) : (
              <button 
                className="btn btn-primary btn-sm" 
                onClick={onConnect}
                style={{ 
                  background: 'linear-gradient(135deg, var(--color-teal), #009cb7)',
                  border: '1px solid var(--color-teal)',
                  color: '#FAF8F5',
                  fontWeight: 600,
                  padding: '7px 14px',
                  fontSize: '0.8rem'
                }}
              >
                🔗 Link Freighter
              </button>
            )}

            {/* Logout Button */}
            <button 
              className="btn btn-ghost btn-sm" 
              onClick={onLogout}
              style={{ 
                border: '1px solid var(--color-border)', 
                color: 'var(--color-text-secondary)', 
                background: '#FFFFFF',
                fontWeight: 600,
                padding: '7px 14px',
                fontSize: '0.8rem'
              }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
