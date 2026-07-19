import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/* ─── Load Google Identity Services script once ─────────────── */
function loadGisScript() {
  return new Promise((resolve) => {
    if (window.google?.accounts) { resolve(); return; }
    const existing = document.getElementById('gis-script');
    if (existing) { existing.addEventListener('load', resolve); return; }
    const s = document.createElement('script');
    s.id = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    document.head.appendChild(s);
  });
}

/* ─── Decode a JWT payload (GIS returns a credential JWT) ───── */
function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch { return null; }
}

export default function Login({ isOpen, onClose, onLogin }) {
  const navigate = useNavigate();

  const navigateForRole = (role) => {
    navigate('/');
  };

  const [activeTab, setActiveTab] = useState('investor');
  const [mode, setMode] = useState('login');

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [signupData, setSignupData] = useState({
    username: '', email: '', password: '', confirmPassword: '',
    full_name: '', company_name: ''
  });
  const [showSignupPass, setShowSignupPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [gisReady, setGisReady] = useState(false);

  const isInvestor = activeTab === 'investor';

  /* ── Load GIS when modal opens ──────────────────────────────── */
  useEffect(() => {
    if (!isOpen || !GOOGLE_CLIENT_ID) return;
    loadGisScript().then(() => setGisReady(true));
  }, [isOpen]);

  const switchTab = (tab) => { setActiveTab(tab); setError(''); setSuccess(''); setIdentifier(''); setPassword(''); };
  const switchMode = (m) => { setMode(m); setError(''); setSuccess(''); };

  /* ── Normal login ───────────────────────────────────────────── */
  const handleLogin = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password, requested_role: activeTab })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed.'); setLoading(false); return; }
      const walletAddr = data.wallet_address || `USER_${data.id}_${data.role.toUpperCase()}`;
      onLogin(walletAddr, data.role, data.id);
      navigateForRole(data.role);
    } catch { setError('Cannot reach server. Make sure the API is running.'); }
    setLoading(false);
  };

  /* ── Normal sign-up ─────────────────────────────────────────── */
  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    if (signupData.password !== signupData.confirmPassword) { setError('Passwords do not match.'); return; }
    if (signupData.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: signupData.username, email: signupData.email,
          password: signupData.password, role: activeTab,
          full_name: signupData.full_name, company_name: signupData.company_name
        })
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Registration failed.'); setLoading(false); return; }
      setSuccess('Account created! You can now sign in.');
      setMode('login');
      setIdentifier(signupData.username);
    } catch { setError('Cannot reach server. Make sure the API is running.'); }
    setLoading(false);
  };

  /* ── Google Sign-In / Sign-Up ───────────────────────────────── */
  const handleGoogle = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError('Google OAuth is not configured. Add VITE_GOOGLE_CLIENT_ID to your .env file.');
      return;
    }
    if (!gisReady || !window.google?.accounts) {
      setError('Google Sign-In is still loading. Please try again in a moment.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        const payload = decodeJwt(response.credential);
        if (!payload) { setError('Invalid Google token received.'); return; }

        setLoading(true); setError('');
        try {
          /* Try login first; if user not found, auto-register them */
          const loginRes = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identifier: payload.email,
              password: `GOOGLE_${payload.sub}`,     // deterministic token-based secret
              requested_role: activeTab
            })
          });

          if (loginRes.ok) {
            const data = await loginRes.json();
            const walletAddr = data.wallet_address || `USER_${data.id}_${data.role.toUpperCase()}`;
            onLogin(walletAddr, data.role, data.id);
            navigateForRole(data.role);
            return;
          }

          /* User not found → register automatically */
          const baseUsername = (payload.email.split('@')[0] + '_' + payload.sub.slice(-4)).replace(/[^a-z0-9_]/gi, '_');
          const regRes = await fetch(`${API}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: baseUsername,
              email: payload.email,
              password: `GOOGLE_${payload.sub}`,
              role: activeTab,
              full_name: payload.name || '',
            })
          });
          const regData = await regRes.json();
          if (!regRes.ok) { setError(regData.error || 'Google sign-up failed.'); setLoading(false); return; }

          /* Log in the newly created account */
          const login2Res = await fetch(`${API}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identifier: payload.email,
              password: `GOOGLE_${payload.sub}`,
              requested_role: activeTab
            })
          });
          const login2Data = await login2Res.json();
          if (!login2Res.ok) { setError(login2Data.error || 'Auto-login after Google sign-up failed.'); setLoading(false); return; }

          const walletAddr = login2Data.wallet_address || `USER_${login2Data.id}_${login2Data.role.toUpperCase()}`;
          onLogin(walletAddr, login2Data.role, login2Data.id);
          navigateForRole(login2Data.role);
        } catch { setError('Cannot reach server. Make sure the API is running.'); }
        setLoading(false);
      }
    });

    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        /* Fallback: render a one-tap button in a hidden div */
        const div = document.getElementById('__gsi_btn_hidden__');
        if (div) {
          window.google.accounts.id.renderButton(div, { theme: 'outline', size: 'large' });
          div.querySelector('div[role=button]')?.click();
        }
      }
    });
  }, [gisReady, activeTab, navigate, onLogin, onClose]);

  if (!isOpen) return null;

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

        /* ── Keyframes ── */
        @keyframes lgPopIn {
          from { transform: scale(0.94) translateY(18px); opacity: 0; }
          to   { transform: scale(1)    translateY(0);    opacity: 1; }
        }
        @keyframes lgFadeIn { from { opacity: 0; } to { opacity: 1; } }

        /* ── Backdrop ── */
        .lg-backdrop {
          position: fixed; inset: 0; z-index: 1100;
          background: rgba(20, 18, 10, 0.55);
          backdrop-filter: blur(12px) saturate(1.3);
          -webkit-backdrop-filter: blur(12px) saturate(1.3);
          display: flex; align-items: center; justify-content: center;
          padding: 16px; overflow-y: auto;
          animation: lgFadeIn 0.25s ease;
        }

        /* ── Modal card ── */
        .lg-card {
          position: relative;
          width: 100%; max-width: 410px;
          border-radius: 28px;
          overflow: hidden;
          animation: lgPopIn 0.38s cubic-bezier(0.16,1,0.3,1);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.35),
            0 30px 70px rgba(0,0,0,0.22),
            0 8px 20px rgba(0,0,0,0.14);
        }

        /* ── Gradient base ── */
        .lg-bg {
          position: absolute; inset: 0;
          background: linear-gradient(160deg,
            #f5f4ee 0%,
            #edecd8 30%,
            #e8e5b0 62%,
            #ddd98a 100%
          );
        }

        /* ── Noise texture overlay ── */
        .lg-noise {
          position: absolute; inset: 0; z-index: 0;
          opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          background-size: 180px;
          pointer-events: none;
        }

        /* ── Content layer ── */
        .lg-glass {
          position: relative; z-index: 1;
          padding: 32px 30px 28px;
          font-family: 'Inter', system-ui, sans-serif;
        }

        /* ── Close button ── */
        .lg-close {
          position: absolute; top: 14px; right: 14px; z-index: 2;
          width: 28px; height: 28px; border-radius: 50%;
          background: rgba(255,255,255,0.6);
          border: 1px solid rgba(255,255,255,0.85);
          color: #666; font-size: 0.78rem; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.18s;
        }
        .lg-close:hover { background: rgba(255,255,255,0.95); color: #111; }

        /* ── Brand pill ── */
        .lg-brand {
          display: inline-flex; align-items: center; gap: 7px;
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(255,255,255,0.9);
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 0.78rem; font-weight: 800;
          color: #1a1a00; letter-spacing: 0.06em;
          margin-bottom: 24px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.07);
        }

        /* ── Headings ── */
        .lg-h1 {
          font-size: 1.65rem; font-weight: 800;
          color: #1a1800; letter-spacing: -0.03em;
          margin: 0 0 5px; line-height: 1.2;
        }
        .lg-sub {
          font-size: 0.79rem; color: rgba(30,28,0,0.48);
          margin: 0 0 22px;
        }

        /* ── Tab toggle ── */
        .lg-tabs {
          display: flex;
          background: rgba(255,255,255,0.45);
          border: 1px solid rgba(255,255,255,0.75);
          padding: 3px; border-radius: 999px;
          margin-bottom: 20px;
        }
        .lg-tab {
          flex: 1; padding: 7px 0;
          border: none; border-radius: 999px;
          font-size: 0.75rem; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          background: transparent; color: rgba(26,24,0,0.45);
          font-family: 'Inter', system-ui, sans-serif;
        }
        .lg-tab.active {
          background: rgba(255,255,255,0.88);
          color: #1a1800;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        /* ── Fields ── */
        .lg-field { margin-bottom: 12px; }
        .lg-label {
          display: block; font-size: 0.68rem; font-weight: 500;
          color: rgba(30,28,0,0.48); margin-bottom: 5px;
          letter-spacing: 0.01em;
        }
        .lg-input-wrap { position: relative; }
        .lg-input {
          width: 100%; padding: 11px 18px;
          border-radius: 999px;
          border: 1.5px solid rgba(255,255,255,0.8);
          background: rgba(255,255,255,0.65);
          font-size: 0.85rem; color: #1a1800;
          outline: none;
          transition: all 0.18s;
          font-family: 'Inter', system-ui, sans-serif;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.05), 0 1px 0 rgba(255,255,255,0.6);
          box-sizing: border-box;
        }
        .lg-input::placeholder { color: rgba(30,28,0,0.28); }
        .lg-input:focus {
          background: rgba(255,255,255,0.9);
          border-color: rgba(255,255,255,1);
          box-shadow: 0 0 0 3px rgba(255,220,50,0.25), inset 0 1px 3px rgba(0,0,0,0.04);
        }
        .lg-eye {
          position: absolute; right: 16px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none; cursor: pointer;
          color: rgba(30,28,0,0.3); font-size: 0.92rem; line-height: 1;
          padding: 0;
        }

        /* ── Primary submit button ── */
        .lg-btn {
          width: 100%; padding: 12px;
          border-radius: 999px; border: none;
          font-size: 0.9rem; font-weight: 700;
          cursor: pointer; margin-top: 6px;
          color: #1a1200;
          background: linear-gradient(135deg, #F5C832 0%, #eabc22 55%, #d8ab14 100%);
          box-shadow: 0 4px 16px rgba(220,180,20,0.4), inset 0 1px 0 rgba(255,255,255,0.3);
          transition: all 0.2s;
          font-family: 'Inter', system-ui, sans-serif;
          letter-spacing: 0.01em;
        }
        .lg-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .lg-btn:not(:disabled):hover {
          background: linear-gradient(135deg, #fdd23e 0%, #f2c42a 55%, #e0b518 100%);
          transform: translateY(-1px);
          box-shadow: 0 7px 22px rgba(220,180,20,0.52), inset 0 1px 0 rgba(255,255,255,0.3);
        }
        .lg-btn:not(:disabled):active { transform: translateY(0); }

        /* ── Social divider ── */
        .lg-or {
          display: flex; align-items: center; gap: 10px;
          margin: 14px 0 10px;
          font-size: 0.68rem; color: rgba(30,28,0,0.32);
          letter-spacing: 0.06em; text-transform: uppercase;
        }
        .lg-or::before, .lg-or::after {
          content: ''; flex: 1; height: 1px;
          background: rgba(30,28,0,0.1);
        }

        /* ── Social buttons row ── */
        .lg-btns-row { display: flex; gap: 9px; }
        .lg-btn-sec {
          flex: 1; padding: 9px 8px;
          border-radius: 999px;
          border: 1.5px solid rgba(255,255,255,0.8);
          background: rgba(255,255,255,0.5);
          font-size: 0.78rem; font-weight: 600;
          color: #2a2800; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          transition: all 0.18s;
          font-family: 'Inter', system-ui, sans-serif;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        .lg-btn-sec:hover { background: rgba(255,255,255,0.82); transform: translateY(-1px); }
        .lg-btn-sec:active { transform: translateY(0); }

        /* ── Alerts ── */
        .lg-err {
          background: rgba(255,255,255,0.55);
          border: 1px solid rgba(200,60,60,0.25);
          color: #a01e1e; border-radius: 14px;
          padding: 8px 13px; font-size: 0.74rem;
          margin-bottom: 11px; line-height: 1.5;
        }
        .lg-ok {
          background: rgba(255,255,255,0.55);
          border: 1px solid rgba(50,170,80,0.25);
          color: #1a6030; border-radius: 14px;
          padding: 8px 13px; font-size: 0.74rem;
          margin-bottom: 11px;
        }

        /* ── Mode switch ── */
        .lg-switch {
          font-size: 0.76rem; color: rgba(30,28,0,0.42);
          text-align: center; margin-top: 16px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        .lg-switch-link {
          font-weight: 700; color: #7a5c00;
          cursor: pointer; background: none;
          border: none; padding: 0; font-size: 0.76rem;
          font-family: 'Inter', system-ui, sans-serif;
        }
        .lg-switch-link:hover { color: #a07800; text-decoration: underline; }

        /* Hidden GIS fallback button */
        #__gsi_btn_hidden__ {
          position: absolute; opacity: 0; pointer-events: none; top: -999px;
        }
      `}} />

      {/* ── BACKDROP ── */}
      <div className="lg-backdrop" onClick={onClose}>

        {/* ── CARD ── */}
        <div className="lg-card" onClick={e => e.stopPropagation()}>

          {/* Gradient + noise */}
          <div className="lg-bg" />
          <div className="lg-noise" />

          {/* Content */}
          <div className="lg-glass">
            <button className="lg-close" onClick={onClose}>✕</button>

            {/* Brand */}
            <div className="lg-brand">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 20L12 4L19 20" stroke="#8a6a00" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 13C9 13 10.5 10.5 12 13C13.5 15.5 15 13 15 13" stroke="#0F2537" strokeWidth="2" strokeLinecap="round" />
              </svg>
              ALETHEIA
            </div>

            {/* Heading */}
            <h2 className="lg-h1">
              {mode === 'login' ? 'Welcome back' : 'Create an account'}
            </h2>
            <p className="lg-sub">
              {mode === 'login'
                ? `Sign in to your ${isInvestor ? 'investor' : 'exporter'} portal`
                : 'Sign up and start trading on Aletheia'}
            </p>

            {/* Portal tabs */}
            <div className="lg-tabs">
              <button className={`lg-tab${activeTab === 'investor' ? ' active' : ''}`}
                onClick={() => switchTab('investor')}>
                📊 Investor
              </button>
              <button className={`lg-tab${activeTab === 'exporter' ? ' active' : ''}`}
                onClick={() => switchTab('exporter')}>
                🌶️ Exporter
              </button>
            </div>

            {/* Alerts */}
            {error && <div className="lg-err">⚠️ {error}</div>}
            {success && <div className="lg-ok">✓ {success}</div>}

            {/* ── LOGIN ── */}
            {mode === 'login' && (
              <form onSubmit={handleLogin}>
                <div className="lg-field">
                  <label className="lg-label">Username or Email</label>
                  <input className="lg-input" type="text" autoFocus required
                    placeholder="e.g. rajesh or rajesh@aletheia.io"
                    value={identifier} onChange={e => setIdentifier(e.target.value)} />
                </div>

                <div className="lg-field">
                  <label className="lg-label">Password</label>
                  <div className="lg-input-wrap">
                    <input className="lg-input" required
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••••••••••"
                      value={password} onChange={e => setPassword(e.target.value)}
                      style={{ paddingRight: '44px' }} />
                    <button type="button" className="lg-eye" onClick={() => setShowPass(v => !v)}>
                      {showPass ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                <button type="submit" className="lg-btn" disabled={loading || !identifier || !password}>
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>

                <div className="lg-or">or continue with</div>

                <div className="lg-btns-row">
                  {/* Apple — visual only */}
                  <button type="button" className="lg-btn-sec"
                    onClick={() => alert('Apple Sign-In coming soon!')}>
                    <svg width="14" height="14" viewBox="0 0 814 1000" fill="currentColor">
                      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46.7 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269-317.3 69.9 0 128.2 43.1 166.5 43.1 36.5 0 105.1-45.6 183.4-45.6z" />
                    </svg>
                    Apple
                  </button>

                  {/* Google — functional */}
                  <button type="button" className="lg-btn-sec" onClick={handleGoogle}>
                    <svg width="14" height="14" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Google
                  </button>
                </div>
              </form>
            )}

            {/* ── SIGN UP ── */}
            {mode === 'signup' && (
              <form onSubmit={handleSignup}>
                <div className="lg-field">
                  <label className="lg-label">{isInvestor ? 'Full Name' : 'Company Name'}</label>
                  <input className="lg-input" type="text"
                    placeholder={isInvestor ? 'Rajesh Kumar Menon' : 'Spice Coast Exports Ltd'}
                    value={isInvestor ? signupData.full_name : signupData.company_name}
                    onChange={e => setSignupData(d => ({
                      ...d, [isInvestor ? 'full_name' : 'company_name']: e.target.value
                    }))} />
                </div>
                <div className="lg-field">
                  <label className="lg-label">Email</label>
                  <input className="lg-input" type="email" required
                    placeholder="you@example.com"
                    value={signupData.email}
                    onChange={e => setSignupData(d => ({ ...d, email: e.target.value }))} />
                </div>
                <div className="lg-field">
                  <label className="lg-label">Username</label>
                  <input className="lg-input" type="text" required
                    placeholder="your_unique_username"
                    value={signupData.username}
                    onChange={e => setSignupData(d => ({ ...d, username: e.target.value }))} />
                </div>
                <div className="lg-field">
                  <label className="lg-label">Password</label>
                  <div className="lg-input-wrap">
                    <input className="lg-input" required
                      type={showSignupPass ? 'text' : 'password'}
                      placeholder="••••••••••••••••"
                      value={signupData.password}
                      onChange={e => setSignupData(d => ({ ...d, password: e.target.value }))}
                      style={{ paddingRight: '44px' }} />
                    <button type="button" className="lg-eye" onClick={() => setShowSignupPass(v => !v)}>
                      {showSignupPass ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <div className="lg-field">
                  <label className="lg-label">Confirm Password</label>
                  <input className="lg-input" type="password" required
                    placeholder="••••••••••••••••"
                    value={signupData.confirmPassword}
                    onChange={e => setSignupData(d => ({ ...d, confirmPassword: e.target.value }))} />
                </div>

                <button type="submit" className="lg-btn" disabled={loading}>
                  {loading ? 'Creating account…' : 'Submit'}
                </button>

                <div className="lg-or">or sign up with</div>

                <div className="lg-btns-row">
                  {/* Apple — visual only */}
                  <button type="button" className="lg-btn-sec"
                    onClick={() => alert('Apple Sign-Up coming soon!')}>
                    <svg width="14" height="14" viewBox="0 0 814 1000" fill="currentColor">
                      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.5-155.5-127.4C46.7 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269-317.3 69.9 0 128.2 43.1 166.5 43.1 36.5 0 105.1-45.6 183.4-45.6z" />
                    </svg>
                    Apple
                  </button>

                  {/* Google — functional */}
                  <button type="button" className="lg-btn-sec" onClick={handleGoogle}>
                    <svg width="14" height="14" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                    </svg>
                    Google
                  </button>
                </div>
              </form>
            )}

            {/* Mode toggle */}
            <div className="lg-switch">
              {mode === 'login' ? (
                <>Don&apos;t have an account?{' '}
                  <button className="lg-switch-link" onClick={() => switchMode('signup')}>Sign up free</button>
                </>
              ) : (
                <>Already have an account?{' '}
                  <button className="lg-switch-link" onClick={() => switchMode('login')}>Sign in</button>
                </>
              )}
            </div>

          </div>{/* /lg-glass */}

          {/* Hidden GIS fallback target */}
          <div id="__gsi_btn_hidden__" />

        </div>{/* /lg-card */}
      </div>{/* /lg-backdrop */}
    </>
  );
}
