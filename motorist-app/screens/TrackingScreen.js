import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, SafeAreaView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { calculateETA } from '../../shared/useLocation';
import {
  RRMapView, ProviderMarker, MotoristMarker, ETABadge, fitMapToCoords,
} from '../../shared/MapComponents';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// --- API client (subset needed by TrackingScreen) ---
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
  patch: (path, body) => api.request('PATCH', path, body),
};

// --- TrackingScreen ---
function TrackingScreen({ navigate, params }) {
  const mapRef    = useRef(null);
  const socketRef = useRef(null);
  const [providerLocation, setProviderLocation] = useState(params?.providerLocation || null);
  const [provider,         setProvider]         = useState(params?.provider || null);
  const [activeProviderId, setActiveProviderId] = useState(params?.provider?.id || null);
  const [eta,              setEta]              = useState({ minutes: '--', distanceKm: '--' });
  const [step,             setStep]             = useState(1);
  const jobLocation = params?.location || { lat: -1.2921, lng: 36.8219 };

  useEffect(() => {
    const jobId = params?.jobId;
    if (!jobId) return;
    api.get('/api/jobs/' + jobId).then(job => {
      if (job?.providerId) {
        setProvider({ id: job.providerId, name: job.providerName, rating: job.providerRatingAvg });
        setActiveProviderId(job.providerId);
      }
      const sm = { matched: 1, en_route: 1, on_site: 2, in_progress: 2, completed: 3 };
      if (sm[job?.status] !== undefined) setStep(sm[job.status]);
    }).catch(() => {});
  }, [params?.jobId]);

  useEffect(() => {
    let socket;
    AsyncStorage.getItem('rr_token').then(token => {
      if (!token) return;
      socket = io(API, { auth: { token }, reconnection: true, reconnectionDelayMax: 30000 });
      socketRef.current = socket;
      socket.on('provider_location', ({ providerId, location }) => {
        setActiveProviderId(curr => { if (!curr || providerId === curr) setProviderLocation(location); return curr; });
      });
      socket.on('job_updated', job => {
        if (job.id !== params?.jobId) return;
        const sm = { matched: 1, en_route: 1, on_site: 2, in_progress: 2, completed: 3 };
        if (sm[job.status] !== undefined) setStep(sm[job.status]);
        if (job.providerId) setActiveProviderId(job.providerId);
      });
    });
    return () => socket?.disconnect();
  }, []);

  useEffect(() => {
    if (!providerLocation) return;
    calculateETA(providerLocation.lat, providerLocation.lng, jobLocation.lat, jobLocation.lng).then(setEta).catch(() => {});
  }, [providerLocation]);

  useEffect(() => {
    if (!providerLocation) return;
    fitMapToCoords(mapRef, [providerLocation, jobLocation]);
  }, [providerLocation?.lat]);

  const handleCancel = () => Alert.alert('Cancel this job?', 'The provider is on their way. Are you sure?', [
    { text: 'Keep Job', style: 'cancel' },
    { text: 'Cancel Job', style: 'destructive', onPress: async () => {
      if (params?.jobId) api.patch('/api/jobs/' + params.jobId + '/status', { status: 'cancelled', cancelReason: 'Cancelled by motorist' }).catch(() => {});
      await AsyncStorage.removeItem('rr_active_job_id');
      navigate('home');
    }},
  ]);

  const steps = ['Matched', 'En Route', 'On Site', 'Pay'];
  const provInitials = provider?.name ? provider.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : '??';

  return (
    <View style={{ flex: 1, backgroundColor: C.dark }}>
      <RRMapView mapRef={mapRef} style={{ flex: 1 }} initialRegion={{ latitude: jobLocation.lat, longitude: jobLocation.lng, latitudeDelta: 0.04, longitudeDelta: 0.04 }}>
        <MotoristMarker location={jobLocation} label="You" />
        {providerLocation && <ProviderMarker location={providerLocation} heading={providerLocation.heading} providerName={provider?.name?.split(' ')[0]} />}
      </RRMapView>
      <View style={ts.etaWrap}><ETABadge minutes={eta.minutes} distanceKm={eta.distanceKm} isLive={!!providerLocation} /></View>
      <SafeAreaView style={ts.panel}>
        {provider ? (
          <View style={ts.provCard}>
            <View style={ts.provRow}>
              <View style={ts.avatar}><Text style={ts.avatarTxt}>{provInitials}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={ts.provName}>{provider.name || 'Your Mechanic'}</Text>
                <Text style={ts.provMeta}>{provider.rating ? ('⭐' + Number(provider.rating).toFixed(1) + ' · ') : ''}{params?.service?.name || 'Roadside Assistance'}</Text>
              </View>
              <View style={ts.callBtn}><Text style={{ fontSize: 16 }}>{'📞'}</Text></View>
            </View>
          </View>
        ) : (
          <View style={[ts.provCard, { alignItems: 'center', paddingVertical: 14 }]}>
            <ActivityIndicator color={C.green} />
            <Text style={[s.tiny, { marginTop: 6 }]}>Connecting to provider...</Text>
          </View>
        )}
        <View style={ts.steps}>
          {steps.map((label, i) => (
            <View key={label} style={{ flex: 1, alignItems: 'center' }}>
              <View style={[ts.stepDot, { backgroundColor: i < step ? C.green : i === step ? C.blue : C.border }]}>
                <Text style={ts.stepNum}>{i < step ? '✓' : i + 1}</Text>
              </View>
              <Text style={[ts.stepLbl, { color: i <= step ? C.text : C.muted }]}>{label}</Text>
            </View>
          ))}
        </View>
        {step >= 2 && (
          <TouchableOpacity style={s.btn} onPress={() => navigate('payment', { ...params, jobId: params?.jobId })}>
            <Text style={s.btnTxt}>Pay KES {params?.service?.price ? Number(params.service.price).toLocaleString() : '...'} &rarr;</Text>
          </TouchableOpacity>
        )}
        {step < 2 && (
          <TouchableOpacity style={{ alignItems: 'center', paddingTop: 10 }} onPress={handleCancel}>
            <Text style={[s.tiny, { color: C.muted }]}>Cancel job</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

const ts = StyleSheet.create({
  etaWrap:   { position: 'absolute', top: 60, alignSelf: 'center' },
  panel:     { backgroundColor: C.dark, borderTopWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 14 },
  provCard:  { backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  provRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:    { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green + '25', borderWidth: 2, borderColor: C.green + '60', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 14, fontWeight: '600', color: C.green },
  provName:  { fontSize: 14, fontWeight: '600', color: C.text },
  provMeta:  { fontSize: 11, color: C.muted, marginTop: 1 },
  callBtn:   { width: 38, height: 38, borderRadius: 19, backgroundColor: C.green + '15', borderWidth: 1, borderColor: C.green + '40', alignItems: 'center', justifyContent: 'center' },
  steps:     { flexDirection: 'row', marginBottom: 14 },
  stepDot:   { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  stepNum:   { fontSize: 10, color: 'white', fontWeight: '600' },
  stepLbl:   { fontSize: 10, textAlign: 'center' },
});

const s = StyleSheet.create({
  btn:   { backgroundColor: C.orange, borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt:{ color: 'white', fontSize: 15, fontWeight: '600' },
  tiny:  { fontSize: 11, color: C.muted },
});

export default TrackingScreen;
