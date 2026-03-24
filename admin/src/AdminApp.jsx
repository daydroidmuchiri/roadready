/**
 * RoadReady Admin Dashboard — Fixed
 *
 * Fixes:
 *   - Added login screen (was publicly accessible)
 *   - Analytics page pulls real data from /api/analytics/dashboard
 *   - Top stats bar uses live API data (was hardcoded)
 *   - AI metrics panel uses live data
 *   - Token stored in localStorage, refreshed on expiry
 */

import { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { io } from 'socket.io-client';

const API = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870',
  yellow: '#D49A0A', dark: '#060F1C', card: '#0C1828',
  border: '#152030', text: '#ECF0F7', muted: '#7A8AA0', error: '#E03A3A',
};

// ─── API client ───────────────────────────────────────────────────────────────
const api = {
  token: () => localStorage.getItem('rr_admin_token'),
  headers: () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${api.token()}`,
  }),
  get:  (path)       => fetch(API + path, { headers: api.headers() }).then(r => { if (r.status === 401) { localStorage.removeItem('rr_admin_token'); window.location.reload(); } return r.json(); }),
  post: (path, body) => fetch(API + path, { method: 'POST', headers: api.headers(), body: JSON.stringify(body) }).then(r => r.json()),
};

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [phone,   setPhone]   = useState('');
  const [step,    setStep]    = useState('phone');   // 'phone' | 'otp'
  const [code,    setCode]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [devCode, setDevCode] = useState('');

  const sendOTP = async () => {
    if (!phone) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API}/api/auth/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\s/g,''), role: 'admin' }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message || 'Failed to send code'); return; }
      if (data.devCode) setDevCode(data.devCode);
      setStep('otp');
    } catch { setError('Network error. Is the API running?'); }
    finally { setLoading(false); }
  };

  const verifyOTP = async () => {
    if (!code) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch(`${API}/api/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/\s/g,''), code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message || 'Incorrect code'); return; }
      if (data.user?.role !== 'admin') { setError('This account does not have admin access.'); return; }
      localStorage.setItem('rr_admin_token', data.token);
      localStorage.setItem('rr_admin_user',  JSON.stringify(data.user));
      onLogin(data.user);
    } catch { setError('Network error'); }
    finally { setLoading(false); }
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
              value={phone} onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendOTP()}
              placeholder="0700 000 001"
              style={{ width: '100%', background: '#060F1C', border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 16, outline: 'none', marginBottom: 12, boxSizing: 'border-box' }}
            />
            {error && <div style={{ color: C.error, fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button onClick={sendOTP} disabled={loading || !phone}
              style={{ width: '100%', background: C.orange, border: 'none', borderRadius: 10, padding: 13, color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (!phone || loading) ? 0.5 : 1 }}>
              {loading ? 'Sending...' : 'Send Code →'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Enter the 6-digit code</div>
            {devCode && <div style={{ background: 'rgba(232,99,26,.1)', border: `1px solid rgba(232,99,26,.3)`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: C.orange, marginBottom: 10 }}>Dev mode code: <strong>{devCode}</strong></div>}
            <input
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,6))}
              onKeyDown={e => e.key === 'Enter' && verifyOTP()}
              placeholder="123456"
              maxLength={6}
              style={{ width: '100%', background: '#060F1C', border: `1.5px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', color: C.text, fontSize: 24, outline: 'none', marginBottom: 12, letterSpacing: 8, textAlign: 'center', boxSizing: 'border-box' }}
            />
            {error && <div style={{ color: C.error, fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button onClick={verifyOTP} disabled={loading || code.length < 6}
              style={{ width: '100%', background: C.orange, border: 'none', borderRadius: 10, padding: 13, color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: (code.length < 6 || loading) ? 0.5 : 1, marginBottom: 10 }}>
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
            <button onClick={() => { setStep('phone'); setCode(''); setError(''); setDevCode(''); }}
              style={{ width: '100%', background: 'transparent', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', padding: 8 }}>
              ← Use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function Badge({ label, color }) {
  const colors = {
    orange: { bg: 'rgba(232,99,26,.15)', text: C.orange },
    blue:   { bg: 'rgba(26,122,232,.15)',  text: C.blue   },
    green:  { bg: 'rgba(0,168,112,.15)',   text: C.green  },
    gray:   { bg: 'rgba(100,100,100,.15)', text: C.muted  },
  };
  const cv = colors[color] || colors.gray;
  return <span style={{ background: cv.bg, color: cv.text, padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 500 }}>{label}</span>;
}

function StatCard({ label, value, delta }) {
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
      {delta && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>{delta}</div>}
    </div>
  );
}

// ─── Map Page ─────────────────────────────────────────────────────────────────
function MapPage({ jobs, onAIDispatch }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 13 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Live Dispatch Map — Nairobi</span>
          <span style={{ fontSize: 11, color: C.muted }}>
            <span style={{ color: C.green }}>●</span> Available &nbsp;
            <span style={{ color: C.blue }}>●</span> En Route &nbsp;
            <span style={{ color: C.orange }}>●</span> Searching
          </span>
        </div>
        <div style={{ background: C.dark, borderRadius: 10, height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${C.border}`, flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 32 }}>🗺️</div>
          <div style={{ fontSize: 13, color: C.muted }}>Integrate Google Maps</div>
          <div style={{ fontSize: 11, color: C.muted }}>Set REACT_APP_MAPS_KEY in .env</div>
          <div style={{ fontSize: 11, color: C.green }}>{jobs.filter(j => !['completed','cancelled'].includes(j.status)).length} active jobs</div>
        </div>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 470 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 9 }}>
          Active Jobs ({jobs.filter(j => !['completed','cancelled'].includes(j.status)).length})
        </div>
        {jobs.filter(j => !['completed','cancelled'].includes(j.status)).map(job => (
          <div key={job.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.orange }}>{job.id}</span>
              <Badge label={job.status?.toUpperCase()} color={job.status === 'searching' ? 'orange' : 'blue'} />
            </div>
            <div style={{ fontSize: 12, color: C.text, margin: '3px 0' }}>{job.motoristName}</div>
            <div style={{ fontSize: 11, color: C.muted }}>📍 {job.address}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
              <span style={{ color: C.orange, fontWeight: 500 }}>KES {job.price?.toLocaleString()}</span>
              <span style={{ color: C.muted }}>{job.serviceId}</span>
            </div>
            {job.status === 'searching' && (
              <div onClick={() => onAIDispatch(job)}
                style={{ background: 'rgba(232,99,26,.1)', border: '1px solid rgba(232,99,26,.2)', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: C.orange, cursor: 'pointer', marginTop: 8, textAlign: 'center' }}>
                🤖 AI dispatch recommendation →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Jobs Page ────────────────────────────────────────────────────────────────
function JobsPage({ jobs }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  const statuses = ['all','searching','matched','in_progress','completed','cancelled'];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>All Jobs ({jobs.length})</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {statuses.map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ background: filter===s ? C.orange : C.card, border: `1px solid ${C.border}`, color: filter===s ? 'white' : C.muted, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 10 }}>
              {s === 'all' ? 'All' : s.replace('_',' ')}
            </button>
          ))}
        </div>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,.04)', borderBottom: `1px solid ${C.border}`, padding: '8px 12px', fontSize: 10, color: C.muted, fontWeight: 500 }}>
          <span style={{ flex: 1.2 }}>ID</span><span style={{ flex: 2 }}>Motorist</span>
          <span style={{ flex: 2 }}>Service</span><span style={{ flex: 2 }}>Status</span>
          <span style={{ flex: 1.5 }}>Provider</span><span style={{ flex: 1, textAlign: 'right' }}>KES</span>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: C.muted, fontSize: 12 }}>No jobs found</div>
        )}
        {filtered.map((job, i) => (
          <div key={job.id} style={{ display: 'flex', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 11, alignItems: 'center', background: i%2===0?'transparent':'rgba(255,255,255,.01)' }}>
            <span style={{ flex: 1.2, color: C.orange, fontWeight: 500 }}>{job.id}</span>
            <span style={{ flex: 2, color: C.text }}>{job.motoristName || '—'}</span>
            <span style={{ flex: 2, color: C.muted }}>{job.serviceId}</span>
            <span style={{ flex: 2 }}><Badge label={job.status?.toUpperCase()} color={job.status==='searching'?'orange':job.status==='completed'?'green':'blue'}/></span>
            <span style={{ flex: 1.5, color: C.muted }}>{job.providerName || '—'}</span>
            <span style={{ flex: 1, color: C.green, textAlign: 'right', fontWeight: 500 }}>{job.price?.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Providers Page ───────────────────────────────────────────────────────────
function ProvidersPage({ providers }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Provider Network ({providers.length})</span>
        <button style={{ background: C.green, border: 'none', color: 'white', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11 }}>+ Onboard Provider</button>
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', background: 'rgba(255,255,255,.04)', borderBottom: `1px solid ${C.border}`, padding: '8px 12px', fontSize: 10, color: C.muted, fontWeight: 500 }}>
          <span style={{ width: 36, marginRight: 8 }}></span>
          <span style={{ flex: 2 }}>Name</span><span style={{ flex: 1.5 }}>Skills</span>
          <span style={{ flex: .8 }}>Rating</span><span style={{ flex: .8 }}>Jobs</span><span style={{ flex: 1.2 }}>Status</span>
        </div>
        {providers.length === 0 && <div style={{ padding: '20px 12px', textAlign: 'center', color: C.muted, fontSize: 12 }}>No providers yet</div>}
        {providers.map((p, i) => {
          const initials = p.name?.split(' ').map(n=>n[0]).join('').slice(0,2) || '??';
          const clr = [C.green, C.blue, C.yellow, C.orange][i%4];
          return (
            <div key={p.id} style={{ display: 'flex', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, alignItems: 'center' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: clr+'22', border: `1px solid ${clr}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: clr, marginRight: 8 }}>{initials}</div>
              <span style={{ flex: 2, color: C.text }}>{p.name}</span>
              <span style={{ flex: 1.5, color: C.muted, fontSize: 11 }}>{Array.isArray(p.skills) ? p.skills.join(', ') : '—'}</span>
              <span style={{ flex: .8, color: C.yellow }}>⭐{Number(p.rating||0).toFixed(1)}</span>
              <span style={{ flex: .8, color: C.muted }}>{p.jobCount||0}</span>
              <span style={{ flex: 1.2 }}><Badge label={(p.status||'offline').toUpperCase()} color={p.status==='available'?'green':p.status==='on_job'?'blue':'gray'}/></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Analytics Page — real data ───────────────────────────────────────────────
function AnalyticsPage() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/api/analytics/dashboard')
      .then(data => { setStats(data); setLoading(false); })
      .catch(() => { setError('Could not load analytics'); setLoading(false); });
  }, []);

  if (loading) return <div style={{ color: C.muted, padding: 20, textAlign: 'center' }}>Loading analytics...</div>;
  if (error)   return <div style={{ color: C.error, padding: 20 }}>{error}</div>;

  const weekly = stats?.weeklyRevenue || [];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 13 }}>Revenue Analytics</div>

      {/* Weekly revenue chart */}
      {weekly.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 12 }}>Weekly Revenue (KES)</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weekly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false}
                     tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} width={36} />
              <Tooltip
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: C.text }}
                formatter={(v) => [`KES ${Number(v).toLocaleString()}`, 'Revenue']}
              />
              <Bar dataKey="revenue" fill={C.orange} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        {[
          { v: (stats?.totalJobsToday||0).toLocaleString(),  l: 'Jobs Today',        d: null,          c: C.orange },
          { v: `KES ${(stats?.revenueToday||0).toLocaleString()}`, l: 'Revenue Today', d: null,          c: C.green  },
          { v: `KES ${(stats?.commissionToday||0).toLocaleString()}`, l: 'Commission Today', d: null,    c: C.blue   },
          { v: `${stats?.avgResponseMinutes||0} min`,        l: 'Avg Response',      d: null,          c: C.yellow },
          { v: (stats?.providersAvailable||0),               l: 'Available Providers', d: null,         c: C.green  },
          { v: (stats?.providersOnJob||0),                   l: 'Providers On Job',  d: null,          c: C.blue   },
        ].map(m => (
          <div key={m.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: m.c }}>{m.v}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{m.l}</div>
          </div>
        ))}
      </div>

      {/* Job completion trend (line chart) */}
      {weekly.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 12 }}>Daily Jobs Trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={weekly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }}
                formatter={(v) => [v, 'Jobs']}
              />
              <Line type="monotone" dataKey="total_jobs" stroke={C.blue} strokeWidth={2} dot={{ fill: C.blue, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── AI Dispatch Page ─────────────────────────────────────────────────────────
function AIPage({ initialQ, stats }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I have live visibility into all active jobs and providers.\n\nWhat would you like to optimise?' }
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const msgsRef = useRef();

  useEffect(() => { if (initialQ) setInput(initialQ); }, [initialQ]);
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setLoading(true);
    const { reply } = await api.post('/api/ai/dispatch', { messages: newMessages.map(m => ({ role: m.role, content: m.content })) });
    setMessages([...newMessages, { role: 'assistant', content: reply }]);
    setLoading(false);
  };

  const quickPrompts = [
    'Who should handle the oldest searching job?',
    'Any SLA breach risk in current active jobs?',
    'Which zones need surge pricing right now?',
    'Who are the top 3 providers this week?',
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 13, height: 500 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '11px 13px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(232,99,26,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🤖</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>AI Dispatch Assistant</div>
            <div style={{ fontSize: 11, color: C.green }}>● Claude · Live data connected</div>
          </div>
        </div>
        <div ref={msgsRef} style={{ flex: 1, overflow: 'auto', padding: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role==='user'?'flex-end':'flex-start' }}>
              <div style={{ maxWidth: '80%', background: m.role==='user'?C.orange:'rgba(255,255,255,.06)', border: m.role!=='user'?`1px solid ${C.border}`:'none', color: 'white', padding: '8px 11px', borderRadius: m.role==='user'?'12px 12px 3px 12px':'12px 12px 12px 3px', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div style={{ background: 'rgba(255,255,255,.06)', border: `1px solid ${C.border}`, padding: '8px 11px', borderRadius: 12, fontSize: 12, color: C.muted }}>Thinking...</div>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '7px 11px' }}>
          {quickPrompts.map(q => (
            <div key={q} onClick={() => setInput(q)} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '4px 10px', fontSize: 11, color: C.muted, cursor: 'pointer' }}>{q.length>32?q.slice(0,32)+'…':q}</div>
          ))}
        </div>
        <div style={{ padding: '9px 11px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 7 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key==='Enter' && send()} placeholder="Ask about jobs, routing, revenue..." style={{ flex: 1, background: 'rgba(255,255,255,.06)', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
          <button onClick={send} style={{ background: C.orange, border: 'none', borderRadius: 7, padding: '7px 11px', color: 'white', cursor: 'pointer', fontSize: 12 }}>➤</button>
        </div>
      </div>
      {/* Live metrics from real API */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 9 }}>Live Metrics</div>
        {[
          { label: 'Jobs searching', value: stats?.activeJobs ?? '—', color: C.orange },
          { label: 'Providers available', value: stats?.providersAvailable ?? '—', color: C.green },
          { label: 'Avg response', value: stats?.avgResponseMinutes ? `${stats.avgResponseMinutes} min` : '—', color: C.blue },
          { label: "Today's revenue", value: stats?.revenueToday ? `KES ${Number(stats.revenueToday).toLocaleString()}` : '—', color: C.yellow },
        ].map(m => (
          <div key={m.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: 11, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: C.muted }}>{m.label}</div>
            <div style={{ fontSize: 20, fontWeight: 500, color: m.color, marginTop: 3 }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Admin App ───────────────────────────────────────────────────────────
export default function AdminApp() {
  const [adminUser,   setAdminUser]   = useState(() => {
    const t = localStorage.getItem('rr_admin_token');
    if (!t) return null;
    try {
      const u = JSON.parse(localStorage.getItem('rr_admin_user') || '{}');
      return { token: t, ...u };
    } catch { return { token: t }; }
  });

  // Re-fetch profile on cold start if we only have a token (no cached name)
  useEffect(() => {
    if (adminUser && !adminUser.name) {
      api.get('/api/auth/me')
        .then(data => {
          if (data.user) {
            const merged = { ...adminUser, ...data.user };
            setAdminUser(merged);
            localStorage.setItem('rr_admin_user', JSON.stringify(data.user));
          }
        })
        .catch(() => {});
    }
  }, [adminUser]);
  const [page,        setPage]        = useState('map');
  const [jobs,        setJobs]        = useState([]);
  const [providers,   setProviders]   = useState([]);
  const [stats,       setStats]       = useState(null);
  const [aiDispatchQ, setAIDispatchQ] = useState('');

  // Load data once logged in
  useEffect(() => {
    if (!adminUser) return;
    api.get('/api/jobs').then(setJobs).catch(() => {});
    api.get('/api/providers').then(setProviders).catch(() => {});
    api.get('/api/analytics/dashboard').then(setStats).catch(() => {});

    const socket = io(API, { auth: { token: api.token() } });
    socket.on('job_updated',      job  => setJobs(prev => prev.map(j => j.id===job.id?job:j)));
    socket.on('new_job',          job  => setJobs(prev => [job,...prev]));
    socket.on('provider_location',({ providerId, location }) => setProviders(prev => prev.map(p => p.id===providerId?{...p,location}:p)));
    socket.on('job_matched',      ()   => api.get('/api/analytics/dashboard').then(setStats).catch(()=>{}));
    return () => socket.disconnect();
  }, [adminUser]);

  // Refresh stats every 60 seconds
  useEffect(() => {
    if (!adminUser) return;
    const interval = setInterval(() => api.get('/api/analytics/dashboard').then(setStats).catch(()=>{}), 60000);
    return () => clearInterval(interval);
  }, [adminUser]);

  if (!adminUser) return <LoginScreen onLogin={user => setAdminUser(user)} />;

  const navItems = [
    { id: 'map',       label: 'Live Map',   icon: '🗺️' },
    { id: 'jobs',      label: 'Jobs',       icon: '⚡' },
    { id: 'providers', label: 'Providers',  icon: '👥' },
    { id: 'analytics', label: 'Analytics',  icon: '📊' },
    { id: 'ai',        label: 'AI Dispatch',icon: '🤖' },
  ];

  const logout = () => { localStorage.removeItem('rr_admin_token'); localStorage.removeItem('rr_admin_user'); setAdminUser(null); };

  return (
    <div style={{ height: '100vh', display: 'flex', background: C.dark, fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <div style={{ width: 180, background: '#0C1828', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 13px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 500, color: C.text }}>Road<span style={{ color: C.orange }}>Ready</span></div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>Ops Centre</div>
        </div>
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {navItems.map(item => (
            <div key={item.id} onClick={() => setPage(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', cursor: 'pointer', color: page===item.id?C.text:C.muted, background: page===item.id?'rgba(255,255,255,.05)':'transparent', borderLeft: `3px solid ${page===item.id?C.orange:'transparent'}`, fontSize: 12 }}>
              {item.icon} {item.label}
            </div>
          ))}
        </nav>
        <div style={{ padding: '12px 13px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.text }}>{adminUser?.name || 'Admin'}</div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>{adminUser?.phone || 'Operations'}</div>
          <div onClick={logout} style={{ fontSize: 11, color: C.muted, cursor: 'pointer', textDecoration: 'underline' }}>Sign out</div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top stats bar — real data */}
        <div style={{ display: 'flex', gap: 9, padding: '10px 13px', borderBottom: `1px solid ${C.border}`, background: '#0C1828' }}>
          <StatCard label="Jobs Today"       value={(stats?.totalJobsToday ?? '—').toLocaleString()} />
          <StatCard label="Revenue"          value={stats?.revenueToday ? `KES ${Number(stats.revenueToday).toLocaleString()}` : '—'} />
          <StatCard label="Active Providers" value={stats?.providersAvailable ?? '—'} />
          <StatCard label="Avg Response"     value={stats?.avgResponseMinutes ? `${stats.avgResponseMinutes} min` : '—'} />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 13 }}>
          {page === 'map'       && <MapPage       jobs={jobs} onAIDispatch={job => { setPage('ai'); setAIDispatchQ(`Best provider for job ${job.id} — ${job.serviceId} at ${job.address}?`); }} />}
          {page === 'jobs'      && <JobsPage      jobs={jobs} />}
          {page === 'providers' && <ProvidersPage providers={providers} />}
          {page === 'analytics' && <AnalyticsPage />}
          {page === 'ai'        && <AIPage        initialQ={aiDispatchQ} stats={stats} />}
        </div>
      </div>
    </div>
  );
}
