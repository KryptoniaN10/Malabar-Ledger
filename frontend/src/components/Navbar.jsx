import React from 'react';
import { NavLink } from 'react-router-dom';
import WalletConnectButton from './WalletConnectButton.jsx';
import NetworkStatusIndicator from './NetworkStatusIndicator.jsx';

export default function Navbar({ walletAddress, connecting, onConnect, onDisconnect }) {
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
        justifyContent: 'between',
        alignItems: 'center'
      }}>
        {/* Logo */}
        <NavLink to="/" className="navbar-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 17C6 17 8 13 12 13C16 13 18 17 22 17" stroke="var(--color-teal)" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M2 7C6 7 8 11 12 11C16 11 18 7 22 7" stroke="var(--color-saffron)" strokeWidth="2" strokeLinecap="round" />
            <line x1="2" y1="12" x2="22" y2="12" stroke="var(--color-border)" strokeWidth="1" strokeDasharray="3 3" />
          </svg>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            MALABAR <span style={{ fontWeight: 400, color: 'var(--color-saffron)' }}>LEDGER</span>
          </span>
        </NavLink>

        {/* Links */}
        <ul className="navbar-links" style={{
          display: 'flex',
          gap: 'var(--space-4)',
          listStyle: 'none',
          margin: 0,
          padding: 0
        }}>
          <li>
            <NavLink to="/marketplace" className={({ isActive }) => isActive ? 'active' : ''}>
              Marketplace
            </NavLink>
          </li>
          <li>
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
              Investor Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="/exporter" className={({ isActive }) => isActive ? 'active' : ''}>
              Exporter Portal
            </NavLink>
          </li>
          <li>
            <NavLink to="/how-it-works" className={({ isActive }) => isActive ? 'active' : ''}>
              How It Works
            </NavLink>
          </li>
          <li>
            <NavLink to="/admin" className={({ isActive }) => isActive ? 'active' : ''}>
              Admin
            </NavLink>
          </li>
        </ul>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <NetworkStatusIndicator />
          <WalletConnectButton 
            walletAddress={walletAddress}
            connecting={connecting}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        </div>
      </div>
    </nav>
  );
}
