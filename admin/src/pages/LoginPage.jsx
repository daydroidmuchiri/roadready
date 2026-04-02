import { useState } from 'react';

import { api } from '../api';
import { C } from '../theme';

export default function LoginPage({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState('phone');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');

  const sendOTP = async () => {
    if (!phone) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${api.baseUrl}/api/auth/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\s/g, ''), role: 'admin' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to send code');
        return;
      }
      if (data.devCode) setDevCode(data.devCode);
      setStep('otp');
    } catch {
      setError('Network error. Is the API running?');
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${api.baseUrl}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\s/g, ''), code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Incorrect code');
        return;
      }
      if (data.user?.role !== 'admin') {
        setError('This account does not have admin access.');
        return;
      }
      localStorage.setItem('rr_admin_token', data.token);
      localStorage.setItem('rr_admin_user', JSON.stringify(data.user));
      onLogin(data.user);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100vh', background: C.dark, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 36, width: 380 }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: C.text, marginBottom: 6 }}>
          Road<span style={{ color: C.orange }}>Ready</span>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 28, textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Operations Centre
        </div>

        {step === 'phone' ? (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Admin phone number</div>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOTP()}
              placeholder="0700 000 001"
              style={{ width: '100%', background: '#060F1C', border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 16, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />
            {error && <div style={{ color: C.error, fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button
              onClick={sendOTP}
              disabled={loading || !phone}
              style={{ width: '100%', background: C.orange, border: 'none', borderRadius: 10, padding: 13, color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (!phone || loading) ? 0.5 : 1 }}
            >
              {loading ? 'Sending...' : 'Send Code ->'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Enter the 6-digit code</div>
            {devCode && <div style={{ background: 'rgba(232,99,26,.1)', border: '1px solid rgba(232,99,26,.3)', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.orange, marginBottom: 10 }}>Dev mode code: <strong>{devCode}</strong></div>}
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && verifyOTP()}
              placeholder="123456"
              maxLength={6}
              style={{ width: '100%', background: '#060F1C', border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 24, outline: 'none', marginBottom: 12, letterSpacing: 8, textAlign: 'center', boxSizing: 'border-box' }}
            />
            {error && <div style={{ color: C.error, fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button
              onClick={verifyOTP}
              disabled={loading || code.length < 6}
              style={{ width: '100%', background: C.orange, border: 'none', borderRadius: 10, padding: 13, color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (code.length < 6 || loading) ? 0.5 : 1, marginBottom: 10 }}
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
            <button
              onClick={() => { setStep('phone'); setCode(''); setError(''); setDevCode(''); }}
              style={{ width: '100%', background: 'transparent', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', padding: 8 }}
            >
              {'<-'} Use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
