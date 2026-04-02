import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { captureException } from '../../shared/sentry';
import { useCurrentLocation } from '../../shared/useLocation';
import {
  RRMapView, MotoristMarker,
} from '../../shared/MapComponents';
import useServices from '../hooks/useServices';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// --- API client (subset needed by RequestScreen) ---
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

// --- SelectServiceScreen ---
function SelectServiceScreen({ navigate, params }) {
  const { services, loading } = useServices();
  return (
    <SafeAreaView style={s.screen}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('home')}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>Select Service</Text>
        <View style={{ width: 50 }} />
      </View>
      {loading ? <View style={s.centre}><ActivityIndicator color={C.orange} /></View> : (
        <ScrollView>
          {services.map(svc => (
            <TouchableOpacity key={svc.id} style={s.svcItem} onPress={() => navigate('confirm', { service: svc, location: params?.location })}>
              <Text style={{ fontSize: 28, marginRight: 12 }}>{svc.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '500', color: C.text }]}>{svc.name}</Text>
                <Text style={s.tiny}>{svc.desc || ('~' + (svc.durationMinutes || svc.duration_minutes || 20) + ' min')}</Text>
              </View>
              <Text style={[s.body, { color: C.orange, fontWeight: '500' }]}>KES {Number(svc.price).toLocaleString()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// --- ConfirmScreen ---
function ConfirmScreen({ navigate, params }) {
  const svc = params?.service;
  const { location: gpsLoc, address: gpsAddr } = useCurrentLocation();
  const location = params?.location || gpsLoc;
  const address  = params?.address  || gpsAddr;
  if (!svc) { useEffect(() => navigate('select', { location }), []); return null; }
  return (
    <SafeAreaView style={[s.screen, { flex: 1 }]}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('select', { location })}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>Confirm Request</Text>
        <View style={{ width: 50 }} />
      </View>
      <View style={{ height: 220 }}>
        {location ? (
          <RRMapView initialRegion={{ latitude: location.lat, longitude: location.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }}>
            <MotoristMarker location={location} label="Your location" />
          </RRMapView>
        ) : (
          <View style={[{ height: 220 }, s.mapPlaceholder]}><ActivityIndicator color={C.orange} /></View>
        )}
      </View>
      <ScrollView style={{ padding: 16 }}>
        <View style={s.confBox}>
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>{svc.emoji}</Text>
          <Text style={[s.title, { textAlign: 'center' }]}>{svc.name}</Text>
          <Text style={[s.tiny, { textAlign: 'center', marginBottom: 14 }]}>Fixed price — no surprises</Text>
          <View style={s.divider} />
          {[['Your location', address || 'Detecting...'], ['Price', 'KES ' + Number(svc.price).toLocaleString()], ['Duration', '~' + (svc.durationMinutes || svc.duration_minutes || 20) + ' min']].map(([k, v]) => (
            <View key={k} style={s.confRow}>
              <Text style={[s.small, { color: C.muted }]}>{k}</Text>
              <Text style={[s.small, { color: C.text, fontWeight: '500', flex: 1, textAlign: 'right' }]} numberOfLines={1}>{v}</Text>
            </View>
          ))}
        </View>
        <View style={s.lockPill}><Text style={[s.tiny, { color: C.orange }]}>{'🔒'} Price locked — provider cannot charge more</Text></View>
        <TouchableOpacity style={[s.btn, !location && { opacity: 0.5 }]} onPress={() => navigate('searching', { service: svc, location, address })} disabled={!location}>
          <Text style={s.btnTxt}>{location ? 'Confirm & Find Provider' : 'Getting location...'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- SearchingScreen: creates the job, waits for job_matched ---
function SearchingScreen({ navigate, params }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const socketRef = useRef(null);
  const [jobId,  setJobId]  = useState(null);
  const [status, setStatus] = useState('creating');
  const [error,  setError]  = useState('');

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.4, duration: 900, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 900, useNativeDriver: true }),
    ])).start();
    run();
    return () => socketRef.current?.disconnect();
  }, []);

  async function run() {
    const svc = params?.service;
    const loc = params?.location;
    if (!svc || !loc) { setError('Missing service or location. Please try again.'); setStatus('failed'); return; }

    const token = await AsyncStorage.getItem('rr_token');
    const socket = io(API, { auth: { token }, reconnection: true, reconnectionDelayMax: 10000 });
    socketRef.current = socket;

    socket.on('job_matched', ({ jobId: matchedId, provider }) => {
      setStatus('matched');
      navigate('tracking', { jobId: matchedId, service: svc, location: loc, provider });
    });

    try {
      setStatus('creating');
      const job = await api.post('/api/jobs', {
        serviceId: svc.id,
        location:  { lat: loc.lat, lng: loc.lng },
        address:   params?.address || (loc.lat.toFixed(4) + ', ' + loc.lng.toFixed(4)),
      });
      setJobId(job.id);
      setStatus('searching');
      await AsyncStorage.setItem('rr_active_job_id', job.id);
    } catch (err) {
      captureException(err, { screen: 'SearchingScreen' });
      setError(err.message || 'Could not create job. Please try again.');
      setStatus('failed');
    }
  }

  const handleCancel = async () => {
    const activeId = jobId || await AsyncStorage.getItem('rr_active_job_id');
    if (activeId) { api.patch('/api/jobs/' + activeId + '/status', { status: 'cancelled', cancelReason: 'Cancelled by motorist' }).catch(() => {}); await AsyncStorage.removeItem('rr_active_job_id'); }
    socketRef.current?.disconnect();
    navigate('home');
  };

  if (status === 'failed') return (
    <SafeAreaView style={s.screen}>
      <View style={s.centre}>
        <Text style={{ fontSize: 40, marginBottom: 14 }}>{'⚠️'}</Text>
        <Text style={[s.title, { marginBottom: 8 }]}>Something went wrong</Text>
        <Text style={[s.small, { textAlign: 'center', marginBottom: 24 }]}>{error}</Text>
        <TouchableOpacity style={s.btn} onPress={() => navigate('confirm', params)}><Text style={s.btnTxt}>Try Again</Text></TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 12 }} onPress={() => navigate('home')}><Text style={[s.small, { color: C.muted }]}>Cancel</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={handleCancel}><Text style={[s.body, { color: C.muted }]}>Cancel</Text></TouchableOpacity>
        <Text style={s.navTitle}>{status === 'creating' ? 'Creating Request...' : 'Finding Provider'}</Text>
        <View style={{ width: 50 }} />
      </View>
      <View style={s.centre}>
        <View style={{ position: 'relative', width: 90, height: 90, marginBottom: 26, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', width: 90, height: 90, borderRadius: 45, borderWidth: 1, borderColor: C.orange + '40', transform: [{ scale: pulseAnim }] }} />
          <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: C.orange + '20', borderWidth: 2, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>{status === 'creating' ? '⏳' : '🔧'}</Text>
          </View>
        </View>
        <Text style={[s.title, { marginBottom: 7 }]}>{status === 'creating' ? 'Creating your request...' : 'Searching nearby...'}</Text>
        {jobId && <Text style={[s.tiny, { color: C.muted, marginBottom: 4 }]}>Job #{jobId}</Text>}
        <Text style={[s.small, { textAlign: 'center', lineHeight: 20 }]}>{status === 'creating' ? 'Connecting you to our network' : 'Matching you with the nearest available mechanic'}</Text>
        <Text style={[s.tiny, { color: C.green, marginTop: 14 }]}>You will get a push notification when matched</Text>
        <TouchableOpacity style={{ marginTop: 28, borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingVertical: 12, paddingHorizontal: 28 }} onPress={handleCancel}>
          <Text style={[s.small, { color: C.muted }]}>Cancel Request</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: C.dark },
  navBar:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  navTitle:     { fontSize: 15, fontWeight: '600', color: C.text },
  centre:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  svcItem:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 11, padding: 12, marginHorizontal: 16, marginBottom: 7, flexDirection: 'row', alignItems: 'center' },
  confBox:      { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 16, marginBottom: 12 },
  confRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  divider:      { height: 0.5, backgroundColor: C.border, marginBottom: 11 },
  lockPill:     { backgroundColor: 'rgba(232,99,26,.1)', borderWidth: 1, borderColor: 'rgba(232,99,26,.2)', borderRadius: 9, padding: 10, marginBottom: 12 },
  mapPlaceholder: { backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center' },
  btn:          { backgroundColor: C.orange, borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt:       { color: 'white', fontSize: 15, fontWeight: '600' },
  title:        { fontSize: 17, fontWeight: '600', color: C.text },
  body:         { fontSize: 14, color: C.muted },
  small:        { fontSize: 12, color: C.muted },
  tiny:         { fontSize: 11, color: C.muted },
});

export { SelectServiceScreen, ConfirmScreen, SearchingScreen };
