import React, { useState, useEffect, useRef } from 'react';

export default function ChatbotWidget({ walletAddress, userRole }) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      text: "👋 Hello! I am **Aletheia AI**, your platform assistant. How can I help you today?",
      sender: 'bot',
      timestamp: new Date()
    }
  ]);

  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  // Determine suggestion chips based on active role
  const getSuggestions = () => {
    if (userRole === 'exporter') {
      return [
        "What is my receivable status?",
        "How does tokenization work?",
        "How are discounts calculated?",
        "How to upload a shipping bill?"
      ];
    }
    if (userRole === 'investor') {
      return [
        "What is my KYC status?",
        "How much have I invested?",
        "How do I browse receivables?",
        "What are the expected yields?"
      ];
    }
    if (userRole === 'admin') {
      return [
        "Show pending shipping documents.",
        "Show pending KYC approvals.",
        "What is the total platform volume?"
      ];
    }
    return [
      "What is Aletheia?",
      "How does tokenization work?",
      "How to register an account?"
    ];
  };

  const handleSend = async (textToSend) => {
    const query = textToSend || inputText;
    if (!query.trim()) return;

    // Add user message
    const userMsg = {
      id: Date.now().toString(),
      text: query,
      sender: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setLoading(true);

    try {
      // Build request context & history (last 5 messages)
      const chatHistory = messages.slice(-5);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

      const response = await fetch(`${apiUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': walletAddress || '',
          'x-user-role': userRole || ''
        },
        body: JSON.stringify({
          message: query,
          history: chatHistory
        })
      });

      if (response.ok) {
        const data = await response.json();
        setMessages(prev => [...prev, {
          id: Date.now().toString() + '-bot',
          text: data.reply,
          sender: 'bot',
          timestamp: new Date()
        }]);
      } else {
        throw new Error('Server returned an error');
      }
    } catch (err) {
      console.error('[Chatbot] Send error', err);
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '-error',
        text: "⚠️ Connection error. I couldn't reach the Aletheia verification API. Please check if the backend server is running.",
        sender: 'bot',
        timestamp: new Date()
      }]);
    }
    setLoading(false);
  };

  // Helper to format basic markdown-like syntax (**bold**, \n line breaks)
  const formatMessage = (text) => {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // code: `text`
    html = html.replace(/`(.*?)`/g, '<code class="monospace" style="background: rgba(0,0,0,0.15); padding: 2px 4px; border-radius: 4px;">$1</code>');
    
    // newline: \n
    html = html.replace(/\n/g, '<br />');

    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <>
      {/* Floating Action Button (FAB) */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--color-saffron), #e58a13)',
          border: 'none',
          boxShadow: '0 8px 32px rgba(196, 154, 69, 0.4)',
          color: 'white',
          fontSize: '1.5rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999,
          transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.1) translateY(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1) translateY(0)';
        }}
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Expandable Chat Window */}
      {isOpen && (
        <div 
          style={{
            position: 'fixed',
            bottom: '96px',
            right: '24px',
            width: '380px',
            height: '500px',
            background: 'var(--color-bg-glass)',
            backdropFilter: 'blur(20px)',
            border: '1px solid var(--color-border-gold)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 999,
            animation: 'slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes slide-up {
              from { transform: translateY(20px) scale(0.95); opacity: 0; }
              to { transform: translateY(0) scale(1); opacity: 1; }
            }
          `}} />

          {/* Window Header */}
          <div style={{
            background: '#0a1628',
            padding: '16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 20L12 4L19 20" stroke="var(--color-teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 13C9 13 10.5 10.5 12 13C13.5 15.5 15 13 15 13" stroke="var(--color-saffron)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            <div>
              <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'white', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Aletheia Support AI</h4>
              <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--color-teal)', fontWeight: 600 }}>● AI Assistant Online</p>
            </div>
          </div>

          {/* Message Stream */}
          <div style={{
            flex: 1,
            padding: '16px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'rgba(15, 37, 55, 0.25)'
          }}>
            {messages.map((msg) => (
              <div 
                key={msg.id}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '80%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start'
                }}
              >
                <div style={{
                  background: msg.sender === 'user' ? '#0F2537' : 'rgba(255, 255, 255, 0.05)',
                  border: msg.sender === 'user' ? '1px solid var(--color-border)' : '1px solid rgba(255,255,255,0.08)',
                  padding: '10px 14px',
                  borderRadius: msg.sender === 'user' ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                  color: msg.sender === 'user' ? 'white' : 'var(--color-text-primary)',
                  fontSize: '0.8rem',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                  {formatMessage(msg.text)}
                </div>
                <span style={{ fontSize: '0.6rem', color: 'var(--color-text-secondary)', marginTop: '4px', opacity: 0.7 }}>
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}

            {loading && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: '4px', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-text-secondary)', animation: 'bounce 1.4s infinite ease-in-out' }}></span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-text-secondary)', animation: 'bounce 1.4s infinite ease-in-out 0.2s' }}></span>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-text-secondary)', animation: 'bounce 1.4s infinite ease-in-out 0.4s' }}></span>
                <style dangerouslySetInnerHTML={{__html: `
                  @keyframes bounce {
                    0%, 80%, 100% { transform: scale(0); }
                    40% { transform: scale(1.0); }
                  }
                `}} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Chips */}
          <div style={{
            padding: '8px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            gap: '6px',
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            background: 'rgba(15, 37, 55, 0.15)',
            scrollbarWidth: 'none'
          }}>
            {getSuggestions().map((chip, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(chip)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '16px',
                  padding: '6px 12px',
                  color: 'var(--color-text-primary)',
                  fontSize: '0.7rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-saffron)';
                  e.currentTarget.style.background = 'rgba(196, 154, 69, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
              >
                {chip}
              </button>
            ))}
          </div>

          {/* Form Input Area */}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            style={{
              padding: '12px',
              borderTop: '1px solid var(--color-border)',
              display: 'flex',
              gap: '8px',
              background: '#0a1628'
            }}
          >
            <input 
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask Aletheia AI..."
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--color-border)',
                borderRadius: '20px',
                padding: '8px 16px',
                color: 'white',
                fontSize: '0.8rem',
                outline: 'none'
              }}
            />
            <button 
              type="submit"
              disabled={loading || !inputText.trim()}
              style={{
                background: 'linear-gradient(135deg, var(--color-saffron), #e58a13)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.9rem',
                opacity: (loading || !inputText.trim()) ? 0.6 : 1
              }}
            >
              ➔
            </button>
          </form>
        </div>
      )}
    </>
  );
}
