import { useState } from 'react';

import { Badge } from '../components/ui';
import { C } from '../theme';

export default function JobsPage({ jobs }) {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  const statuses = ['all', 'searching', 'matched', 'in_progress', 'completed', 'cancelled'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>All Jobs ({jobs.length})</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {statuses.map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ background: filter === s ? C.orange : C.card, border: `1px solid ${C.border}`, color: filter === s ? 'white' : C.muted, padding: '5px 9px', borderRadius: 7, cursor: 'pointer', fontSize: 10 }}>
              {s === 'all' ? 'All' : s.replace('_', ' ')}
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
        {filtered.length === 0 && <div style={{ padding: '20px 12px', textAlign: 'center', color: C.muted, fontSize: 12 }}>No jobs found</div>}
        {filtered.map((job, i) => (
          <div key={job.id} style={{ display: 'flex', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 11, alignItems: 'center', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.01)' }}>
            <span style={{ flex: 1.2, color: C.orange, fontWeight: 500 }}>{job.id}</span>
            <span style={{ flex: 2, color: C.text }}>{job.motoristName || '—'}</span>
            <span style={{ flex: 2, color: C.muted }}>{job.serviceId}</span>
            <span style={{ flex: 2 }}><Badge label={job.status?.toUpperCase()} color={job.status === 'searching' ? 'orange' : job.status === 'completed' ? 'green' : 'blue'} /></span>
            <span style={{ flex: 1.5, color: C.muted }}>{job.providerName || '—'}</span>
            <span style={{ flex: 1, color: C.green, textAlign: 'right', fontWeight: 500 }}>{job.price?.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
