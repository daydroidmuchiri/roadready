/**
 * RoadReady Motorist App — navigation shell
 * React Native (Expo)
 *
 * All screen components live in their own files under screens/ and hooks/.
 * This file owns: App root, useAuth, navigate, screen registry,
 * the api client, the C colour object, the s StyleSheet.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNotifications, registerTokenAfterLogin, clearBadge,
} from '../shared/useNotifications';
import { AuthFlow, useAuth } from '../shared/AuthScreens';
import { initSentry, setUser as setSentryUser } from '../shared/sentry';

import HomeScreen       from './screens/HomeScreen';
import { SelectServiceScreen, ConfirmScreen, SearchingScreen } from './screens/RequestScreen';
import TrackingScreen   from './screens/TrackingScreen';
import PaymentScreen    from './screens/PaymentScreen';
import DiagnosisScreen  from './screens/DiagnosisScreen';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// --- API client with 15s timeout ---
const api = {
  async getToken() { return AsyncStorage.getItem('rr_token'); },
  async request(method, path, body) {
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'HTTP ' + r.status);
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
  get:   (path)       => api.request('GET',   path),
  post:  (path, body) => api.request('POST',  path, body),
  patch: (path, body) => api.request('PATCH', path, body),
};

// --- Root App ---
export default function App() {
  const { user, loading, refetch } = useAuth();
  const [screen, setScreen] = useState('home');
  const [params, setParams] = useState({});
  useEffect(() => { if (user?.id) setSentryUser(user.id, user.role); }, [user?.id]);
  const navigate = useCallback((to, p) => { setScreen(to); setParams(p || {}); }, []);
  useNotifications({ onNavigateTo: navigate });
  useEffect(() => { registerTokenAfterLogin(); clearBadge(); initSentry(); }, []);
  if (loading) return <View style={{ flex: 1, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 24, fontWeight: '700', color: C.text }}>Road<Text style={{ color: C.orange }}>Ready</Text></Text></View>;
  if (!user) return <AuthFlow role="motorist" onAuthenticated={refetch} />;
  const props = { navigate, params, user };
  const screens = {
    home:      <HomeScreen {...props} />,
    select:    <SelectServiceScreen {...props} />,
    confirm:   <ConfirmScreen {...props} />,
    searching: <SearchingScreen {...props} />,
    tracking:  <TrackingScreen {...props} />,
    payment:   <PaymentScreen {...props} />,
    diagnosis: <DiagnosisScreen {...props} />,
  };
  return screens[screen] || screens.home;
}

const s = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: C.dark },
  hdr:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  logo:         { fontSize: 17, fontWeight: '600', color: C.text },
  greeting:     { fontSize: 11, color: C.muted },
  miniMapWrap:  { height: 180, marginHorizontal: 16, marginBottom: 10, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  miniMap:      { flex: 1 },
  mapPlaceholder: { backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  locationBar:  { backgroundColor: C.card, borderRadius: 9, padding: 10, marginHorizontal: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  sos:          { backgroundColor: C.orange, borderRadius: 16, padding: 22, marginHorizontal: 16, marginBottom: 16, alignItems: 'center' },
  sosBig:       { color: 'white', fontSize: 22, fontWeight: '700', letterSpacing: -1 },
  sosSub:       { color: 'rgba(255,255,255,.75)', fontSize: 12, marginTop: 3 },
  secTitle:     { fontSize: 13, fontWeight: '600', color: C.text, marginHorizontal: 16, marginBottom: 9 },
  quickGrid:    { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 8, paddingBottom: 24 },
  quickItem:    { width: '30%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 10, alignItems: 'center' },
  svcItem:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 12, marginHorizontal: 16, marginBottom: 7, flexDirection: 'row', alignItems: 'center' },
  confBox:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 16, marginBottom: 12 },
  confRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  divider:      { height: 0.5, backgroundColor: C.border, marginBottom: 11 },
  lockPill:     { backgroundColor: 'rgba(232,99,26,.1)', borderWidth: 1, borderColor: 'rgba(232,99,26,.2)', borderRadius: 9, padding: 10, marginBottom: 12 },
  card:         { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 14 },
  navBar:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  navTitle:     { fontSize: 15, fontWeight: '600', color: C.text },
  centre:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  btn:          { backgroundColor: C.orange, borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt:       { color: 'white', fontSize: 15, fontWeight: '600' },
  input:        { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 12, color: C.text, fontSize: 14 },
  iconBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  qp:           { backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  title:        { fontSize: 17, fontWeight: '600', color: C.text },
  body:         { fontSize: 14, color: C.muted },
  small:        { fontSize: 12, color: C.muted },
  tiny:         { fontSize: 11, color: C.muted },
});
