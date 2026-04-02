import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';

import { api } from '../api';
import { C } from '../theme';

export default function AnalyticsPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/analytics/dashboard')
      .then(data => { setStats(data); setLoading(false); })
      .catch(() => { setError('Could not load analytics'); setLoading(false); });
  }, []);

  if (loading) return <div style={{ color: C.muted, padding: 20, textAlign: 'center' }}>Loading analytics...</div>;
  if (error) return <div style={{ color: C.error, padding: 20 }}>{error}</div>;

  const weekly = stats?.weeklyRevenue || [];

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.text, marginBottom: 13 }}>Revenue Analytics</div>
      {weekly.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 12 }}>Weekly Revenue (KES)</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weekly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} width={36} />
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} labelStyle={{ color: C.text }} formatter={v => [`KES ${Number(v).toLocaleString()}`, 'Revenue']} />
              <Bar dataKey="revenue" fill={C.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
        {[
          { v: (stats?.totalJobsToday || 0).toLocaleString(), l: 'Jobs Today', c: C.orange },
          { v: `KES ${(stats?.revenueToday || 0).toLocaleString()}`, l: 'Revenue Today', c: C.green },
          { v: `KES ${(stats?.commissionToday || 0).toLocaleString()}`, l: 'Commission Today', c: C.blue },
          { v: `${stats?.avgResponseMinutes || 0} min`, l: 'Avg Response', c: C.yellow },
          { v: (stats?.providersAvailable || 0), l: 'Available Providers', c: C.green },
          { v: (stats?.providersOnJob || 0), l: 'Providers On Job', c: C.blue },
        ].map(m => (
          <div key={m.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: m.c }}>{m.v}</div>
            <div style={{ fontSize: 11, color: C.muted }}>{m.l}</div>
          </div>
        ))}
      </div>

      {weekly.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.text, marginBottom: 12 }}>Daily Jobs Trend</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={weekly} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11 }} formatter={v => [v, 'Jobs']} />
              <Line type="monotone" dataKey="total_jobs" stroke={C.blue} strokeWidth={2} dot={{ fill: C.blue, r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
