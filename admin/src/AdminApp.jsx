import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

import { api } from './api';
import { StatCard } from './components/ui';
import LoginPage from './pages/LoginPage';
import MapPage from './pages/MapPage';
import JobsPage from './pages/JobsPage';
import ProvidersPage from './pages/ProvidersPage';
import AnalyticsPage from './pages/AnalyticsPage';
import AIPage from './pages/AIPage';
import { C } from './theme';

export default function AdminApp() {
  const [adminUser, setAdminUser] = useState(() => {
    const token = localStorage.getItem('rr_admin_token');
    if (!token) return null;
    try {
      const user = JSON.parse(localStorage.getItem('rr_admin_user') || '{}');
      return { token, ...user };
    } catch {
      return { token };
    }
  });
  const [page, setPage] = useState('map');
  const [jobs, setJobs] = useState([]);
  const [providers, setProviders] = useState([]);
  const [stats, setStats] = useState(null);
  const [aiDispatchQ, setAIDispatchQ] = useState('');

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

  useEffect(() => {
    if (!adminUser) return;
    api.get('/api/jobs').then(setJobs).catch(() => {});
    api.get('/api/providers').then(setProviders).catch(() => {});
    api.get('/api/analytics/dashboard').then(setStats).catch(() => {});

    const socket = io(api.baseUrl, { auth: { token: api.token() } });
    socket.on('job_updated', job => setJobs(prev => prev.map(j => j.id === job.id ? job : j)));
    socket.on('new_job', job => setJobs(prev => [job, ...prev]));
    socket.on('provider_location', ({ providerId, location }) => setProviders(prev => prev.map(p => p.id === providerId ? { ...p, location } : p)));
    socket.on('job_matched', () => api.get('/api/analytics/dashboard').then(setStats).catch(() => {}));
    return () => socket.disconnect();
  }, [adminUser]);

  useEffect(() => {
    if (!adminUser) return;
    const interval = setInterval(() => api.get('/api/analytics/dashboard').then(setStats).catch(() => {}), 60000);
    return () => clearInterval(interval);
  }, [adminUser]);

  if (!adminUser) return <LoginPage onLogin={user => setAdminUser(user)} />;

  const navItems = [
    { id: 'map', label: 'Live Map', icon: '🗺️' },
    { id: 'jobs', label: 'Jobs', icon: '⚡' },
    { id: 'providers', label: 'Providers', icon: '👥' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
    { id: 'ai', label: 'AI Dispatch', icon: '🤖' },
  ];

  const logout = () => {
    localStorage.removeItem('rr_admin_token');
    localStorage.removeItem('rr_admin_user');
    setAdminUser(null);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', background: C.dark, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: 180, background: '#0C1828', borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 13px 12px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 17, fontWeight: 500, color: C.text }}>Road<span style={{ color: C.orange }}>Ready</span></div>
          <div style={{ fontSize: 9, color: C.muted, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>Ops Centre</div>
        </div>
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {navItems.map(item => (
            <div key={item.id} onClick={() => setPage(item.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', cursor: 'pointer', color: page === item.id ? C.text : C.muted, background: page === item.id ? 'rgba(255,255,255,.05)' : 'transparent', borderLeft: `3px solid ${page === item.id ? C.orange : 'transparent'}`, fontSize: 12 }}>
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

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 9, padding: '10px 13px', borderBottom: `1px solid ${C.border}`, background: '#0C1828' }}>
          <StatCard label="Jobs Today" value={(stats?.totalJobsToday ?? '—').toLocaleString()} />
          <StatCard label="Revenue" value={stats?.revenueToday ? `KES ${Number(stats.revenueToday).toLocaleString()}` : '—'} />
          <StatCard label="Active Providers" value={stats?.providersAvailable ?? '—'} />
          <StatCard label="Avg Response" value={stats?.avgResponseMinutes ? `${stats.avgResponseMinutes} min` : '—'} />
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 13 }}>
          {page === 'map' && <MapPage jobs={jobs} onAIDispatch={job => { setPage('ai'); setAIDispatchQ(`Best provider for job ${job.id} - ${job.serviceId} at ${job.address}?`); }} />}
          {page === 'jobs' && <JobsPage jobs={jobs} />}
          {page === 'providers' && <ProvidersPage providers={providers} />}
          {page === 'analytics' && <AnalyticsPage />}
          {page === 'ai' && <AIPage initialQ={aiDispatchQ} stats={stats} />}
        </div>
      </div>
    </div>
  );
}
