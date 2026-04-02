import { useEffect, useRef, useState } from 'react';

import { api } from '../api';
import { C } from '../theme';

export default function AIPage({ initialQ, stats }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hello! I have live visibility into all active jobs and providers.\n\nWhat would you like to optimise?' },
  ]);
  const [input, setInput] = useState('');
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
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', background: m.role === 'user' ? C.orange : 'rgba(255,255,255,.06)', border: m.role !== 'user' ? `1px solid ${C.border}` : 'none', color: 'white', padding: '8px 11px', borderRadius: m.role === 'user' ? '12px 12px 3px 12px' : '12px 12px 12px 3px', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && <div style={{ background: 'rgba(255,255,255,.06)', border: `1px solid ${C.border}`, padding: '8px 11px', borderRadius: 12, fontSize: 12, color: C.muted }}>Thinking...</div>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '7px 11px' }}>
          {quickPrompts.map(q => (
            <div key={q} onClick={() => setInput(q)} style={{ background: 'rgba(255,255,255,.05)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '4px 10px', fontSize: 11, color: C.muted, cursor: 'pointer' }}>{q.length > 32 ? q.slice(0, 32) + '…' : q}</div>
          ))}
        </div>
        <div style={{ padding: '9px 11px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 7 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Ask about jobs, routing, revenue..." style={{ flex: 1, background: 'rgba(255,255,255,.06)', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', color: C.text, fontSize: 12, outline: 'none' }} />
          <button onClick={send} style={{ background: C.orange, border: 'none', borderRadius: 7, padding: '7px 11px', color: 'white', cursor: 'pointer', fontSize: 12 }}>➤</button>
        </div>
      </div>
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
