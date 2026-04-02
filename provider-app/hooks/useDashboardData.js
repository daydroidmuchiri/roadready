import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Provider dashboard data hook ─────────────────────────────────────────────
// Fetches everything the dashboard needs in one call to /api/providers/me.
// The backend augments this endpoint with todayEarnings, todayJobs, recentJobs.

function useDashboardData() {
  const [data, setData] = React.useState({
    todayEarnings: 0, todayJobs: 0, totalJobs: 0,
    rating: '0.0', recentJobs: [], loading: true, error: false,
  });

  const load = React.useCallback(async () => {
    setData(d => ({ ...d, loading: true, error: false }));
    try {
      const token = await AsyncStorage.getItem('rr_token');
      if (!token) { setData(d => ({ ...d, loading: false })); return; }
      const res  = await fetch(`${API}/api/providers/me`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed');
      setData({
        loading:       false,
        error:         false,
        todayEarnings: json.todayEarnings || 0,
        todayJobs:     json.todayJobs     || 0,
        totalJobs:     json.profile?.totalJobs || 0,
        rating:        Number(json.rating || 0).toFixed(1),
        recentJobs:    Array.isArray(json.recentJobs) ? json.recentJobs : [],
      });
    } catch {
      setData(d => ({ ...d, loading: false, error: true }));
    }
  }, []);

  React.useEffect(() => { load(); }, []);
  return { ...data, refresh: load };
}

export default useDashboardData;
