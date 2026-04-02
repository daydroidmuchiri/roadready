import React from 'react';

import { Badge } from '../components/ui';
import { C } from '../theme';

export default function MapPage({ jobs, onAIDispatch }) {
  const activeJobs = jobs.filter(j => !['completed', 'cancelled'].includes(j.status));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 13 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>Live Dispatch Map - Nairobi</span>
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
          <div style={{ fontSize: 11, color: C.green }}>{activeJobs.length} active jobs</div>
        </div>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 470 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 9 }}>
          Active Jobs ({activeJobs.length})
        </div>
        {activeJobs.map(job => (
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
              <div onClick={() => onAIDispatch(job)} style={{ background: 'rgba(232,99,26,.1)', border: '1px solid rgba(232,99,26,.2)', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: C.orange, cursor: 'pointer', marginTop: 8, textAlign: 'center' }}>
                AI dispatch recommendation ->
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
