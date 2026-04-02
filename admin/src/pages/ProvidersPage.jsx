import { Badge } from '../components/ui';
import { C } from '../theme';

export default function ProvidersPage({ providers }) {
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
          <span style={{ flex: 0.8 }}>Rating</span><span style={{ flex: 0.8 }}>Jobs</span><span style={{ flex: 1.2 }}>Status</span>
        </div>
        {providers.length === 0 && <div style={{ padding: '20px 12px', textAlign: 'center', color: C.muted, fontSize: 12 }}>No providers yet</div>}
        {providers.map((p, i) => {
          const initials = p.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '??';
          const clr = [C.green, C.blue, C.yellow, C.orange][i % 4];
          return (
            <div key={p.id} style={{ display: 'flex', padding: '9px 12px', borderBottom: `1px solid ${C.border}`, fontSize: 12, alignItems: 'center' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: clr + '22', border: `1px solid ${clr}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: clr, marginRight: 8 }}>{initials}</div>
              <span style={{ flex: 2, color: C.text }}>{p.name}</span>
              <span style={{ flex: 1.5, color: C.muted, fontSize: 11 }}>{Array.isArray(p.skills) ? p.skills.join(', ') : '—'}</span>
              <span style={{ flex: 0.8, color: C.yellow }}>⭐{Number(p.rating || 0).toFixed(1)}</span>
              <span style={{ flex: 0.8, color: C.muted }}>{p.jobCount || 0}</span>
              <span style={{ flex: 1.2 }}><Badge label={(p.status || 'offline').toUpperCase()} color={p.status === 'available' ? 'green' : p.status === 'on_job' ? 'blue' : 'gray'} /></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
