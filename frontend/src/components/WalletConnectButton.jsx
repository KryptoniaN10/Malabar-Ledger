import React from 'react';
import { formatAddress } from '../stellar/client.js';

export default function WalletConnectButton({ walletAddress, connecting, onConnect, onDisconnect }) {
  if (walletAddress) {
    return (
      <div className="flex items-center gap-2">
        <div 
          className="btn btn-outline btn-sm"
          style={{ cursor: 'default', fontFamily: 'monospace' }}
          title={walletAddress}
        >
          {formatAddress(walletAddress, 4)}
        </div>
        <button 
          className="btn btn-ghost btn-sm" 
          onClick={onDisconnect}
          title="Disconnect Wallet"
          style={{ padding: '6px 10px' }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button 
      className="btn btn-primary btn-sm" 
      onClick={onConnect} 
      disabled={connecting}
      id="connect-wallet-btn"
    >
      {connecting ? (
        <>
          <div className="spinner" style={{ width: 14, height: 14 }} /> 
          Connecting...
        </>
      ) : (
        'Connect Wallet'
      )}
    </button>
  );
}
