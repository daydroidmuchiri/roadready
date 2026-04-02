/**
 * RoadReady Provider App — navigation shell
 * React Native (Expo)
 *
 * All screen components live in their own files under screens/ and components/.
 * This file owns: ProviderApp root, socket setup, handleToggle,
 * isOnline state, incomingJob state, tab bar, the s StyleSheet.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNotifications, registerTokenAfterLogin, clearBadge,
} from '../shared/useNotifications';
import {
  useProviderBackgroundServices,
} from '../shared/backgroundServices';
import { AuthFlow, useAuth } from '../shared/AuthScreens';
import { initSentry, setUser } from '../shared/sentry';

import useDashboardData from './hooks/useDashboardData';
import JobAlertModal   from './components/JobAlertModal';
import NavigatingScreen from './screens/NavigationScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import DashboardScreen  from './screens/DashboardScreen';
import DoneScreen       from './screens/JobScreen';
import PayoutsScreen    from './screens/PayoutsScreen';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function ProviderApp() {
  const { user, loading, refetch } = useAuth();
  React.useEffect(() => { if (user?.id) setUser(user.id, user.role); }, [user?.id]);
  const [screen,      setScreen]      = useState('dashboard');
  const [params,      setParams]      = useState({});
  const [isOnline,    setIsOnline]    = useState(false);
  const [incomingJob, setIncomingJob] = useState(null);
  const socketRef = useRef(null);

  const dashData = useDashboardData();

  // Refresh dashboard when returning from a completed job
  React.useEffect(() => {
    if (screen === 'dashboard') dashData.refresh();
  }, [screen]);

  const navigate = useCallback((to, p) => { setScreen(to); if (p) setParams(p); }, []);

  useNotifications({ onJobAlert: setIncomingJob, onNavigateTo: navigate });

  // Background location + offline queue — active when navigating to a job
  useProviderBackgroundServices({ isNavigatingToJob: screen === 'navigating' });

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#060F1C', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#ECF0F7' }}>Road<Text style={{ color: '#00A870' }}>Ready</Text></Text>
      </View>
    );
  }

  if (!user) {
    return <AuthFlow role="provider" onAuthenticated={refetch} />;
  }

  // Persistent socket connection
  useEffect(() => {
    let socket;
    AsyncStorage.getItem('rr_token').then(token => {
      if (!token) return;
      socket = io(API, { auth: { token }, reconnection: true, reconnectionDelayMax: 30000 });
      socket.on('new_job', job => { if (isOnline) setIncomingJob(job); });
      socketRef.current = socket;
    });
    return () => socket?.disconnect();
  }, [isOnline]);

  useEffect(() => {
    registerTokenAfterLogin();
    clearBadge();
    initSentry();
  }, []);

  const handleToggle = async (value) => {
    setIsOnline(value);
    try {
      const token = await AsyncStorage.getItem('rr_token');
      const res = await fetch(`${API}/api/providers/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: value ? 'available' : 'offline' }),
      });
      if (!res.ok) setIsOnline(!value);
    } catch { setIsOnline(!value); }
  };

  // TODO: remove mockJob — use a real job from the dispatch system
  // This was placeholder demo data. Simulate button should be hidden 
  // in production (NODE_ENV check).
  const mockJob = null;

  const props = { navigate, params, socket: socketRef.current };

  const screens = {
    dashboard:   <DashboardScreen {...props} isOnline={isOnline} onToggle={handleToggle} onSimulate={() => setIncomingJob(mockJob)} dashData={dashData} />,
    navigating:  <NavigatingScreen {...props} />,
    done:        <DoneScreen {...props} />,
    payouts:     <PayoutsScreen {...props} />,
    onboarding:  <OnboardingScreen {...props} />,
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.dark }}>
      {screens[screen] || screens.dashboard}

      {incomingJob && (
        <JobAlertModal
          job={incomingJob}
          onAccept={() => { const j = incomingJob; setIncomingJob(null); navigate('navigating', { job: j }); }}
          onDecline={() => setIncomingJob(null)}
        />
      )}

      {screen !== 'navigating' && (
        <View style={s.tabs}>
          {[['dashboard','🏠','Home'],['navigating','🗺️','Navigate'],['payouts','💰','Payouts'],['onboarding','📋','Profile']].map(([id,e,l]) => (
            <TouchableOpacity key={id} onPress={() => navigate(id)} style={s.tab}>
              <Text style={{ fontSize: 18, marginBottom: 2 }}>{e}</Text>
              <Text style={[s.tiny, { color: screen === id ? C.orange : C.muted }]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  hdr:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  logo:      { fontSize: 17, fontWeight: '600', color: '#ECF0F7' },
  sub:       { fontSize: 11, color: '#7A8AA0' },
  statusRow: { backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 11, padding: 12, marginHorizontal: 16, marginBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 7, marginBottom: 14 },
  statCard:  { width: '47%', backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 11, padding: 11 },
  secTitle:  { fontSize: 13, fontWeight: '600', color: '#ECF0F7', marginHorizontal: 16, marginBottom: 9 },
  jobRow:    { backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 10, padding: 10, marginHorizontal: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  simBtn:    { backgroundColor: 'rgba(232,99,26,.08)', borderWidth: 1, borderColor: 'rgba(232,99,26,.2)', borderRadius: 9, padding: 12, flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 6, marginBottom: 24 },
  tabs:      { flexDirection: 'row', borderTopWidth: 1, borderColor: '#152030', backgroundColor: '#0C1828' },
  tab:       { flex: 1, alignItems: 'center', padding: 9 },
  btn:       { backgroundColor: '#E8631A', borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt:    { color: 'white', fontSize: 15, fontWeight: '600' },
  title:     { fontSize: 17, fontWeight: '600', color: '#ECF0F7' },
  body:      { fontSize: 14, color: '#7A8AA0' },
  small:     { fontSize: 12, color: '#7A8AA0' },
  tiny:      { fontSize: 11, color: '#7A8AA0' },
});
