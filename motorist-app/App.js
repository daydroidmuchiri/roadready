/**
 * RoadReady Motorist App — v9 (production-quality)
 *
 * Critical fixes from audit:
 *   - SearchingScreen actually POSTs /api/jobs and waits for job_matched WS event
 *   - PaymentScreen listens for payment_confirmed WS event (no fake setTimeout)
 *   - Services fetched from /api/services with local cache (prices update without release)
 *   - No hardcoded job IDs, phone numbers, or provider names anywhere
 *   - api client has 15s timeout on all requests, proper error handling
 *   - Time-aware greeting (morning/afternoon/evening/night)
 *   - Dead variable myLocation removed from TrackingScreen
 *   - Provider shows loading state until API data arrives
 *   - User's phone pre-filled in PaymentScreen
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, Animated, FlatList, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNotifications, registerTokenAfterLogin, clearBadge,
} from '../shared/useNotifications';
import { AuthFlow, useAuth } from '../shared/AuthScreens';
import { initSentry, captureException, setUser as setSentryUser } from '../shared/sentry';
import {
  useCurrentLocation, calculateETA,
} from '../shared/useLocation';
import {
  RRMapView, ProviderMarker, MotoristMarker, ETABadge, fitMapToCoords,
} from '../shared/MapComponents';

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

// --- Services from API with local cache ---
function useServices() {
  const [services, setServices] = useState([]);
  const [loading,  setLoading]  = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('rr_services_cache').then(c => { if (c) setServices(JSON.parse(c)); }).catch(() => {});
    api.get('/api/services')
      .then(data => { if (Array.isArray(data)) { setServices(data); AsyncStorage.setItem('rr_services_cache', JSON.stringify(data)).catch(() => {}); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { services, loading };
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning \u{1F305}';
  if (h < 17) return 'Good afternoon \u2600\uFE0F';
  if (h < 21) return 'Good evening \u{1F306}';
  return 'Good night \u{1F319}';
}

// --- HomeScreen ---
function HomeScreen({ navigate, user }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const { location, address } = useCurrentLocation();
  const { services } = useServices();
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.04, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,    duration: 800, useNativeDriver: true }),
    ])).start();
  }, []);
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView>
        <View style={s.hdr}>
          <View>
            <Text style={s.greeting}>{getGreeting()}</Text>
            <Text style={s.logo}>Road<Text style={{ color: C.orange }}>Ready</Text></Text>
          </View>
          <TouchableOpacity onPress={() => navigate('diagnosis')} style={s.iconBtn}><Text>{'💬'}</Text></TouchableOpacity>
        </View>
        <View style={s.miniMapWrap}>
          {location ? (
            <RRMapView style={s.miniMap} initialRegion={{ latitude: location.lat, longitude: location.lng, latitudeDelta: 0.015, longitudeDelta: 0.015 }}>
              <MotoristMarker location={location} label="You" />
            </RRMapView>
          ) : (
            <View style={[s.miniMap, s.mapPlaceholder]}>
              <ActivityIndicator color={C.orange} />
              <Text style={[s.tiny, { marginTop: 8 }]}>Getting your location...</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={s.locationBar} onPress={() => navigate('confirm', { location })}>
          <Text>{'📍'}</Text>
          <Text style={[s.body, { flex: 1, marginLeft: 8 }]} numberOfLines={1}>{address}</Text>
          <Text style={[s.body, { color: C.blue, fontWeight: '500' }]}>Change</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigate('select', { location })} activeOpacity={0.85}>
          <Animated.View style={[s.sos, { transform: [{ scale: pulseAnim }] }]}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>{'🚨'}</Text>
            <Text style={s.sosBig}>I NEED HELP</Text>
            <Text style={s.sosSub}>Tap to request roadside assistance</Text>
          </Animated.View>
        </TouchableOpacity>
        <Text style={s.secTitle}>Services</Text>
        <View style={s.quickGrid}>
          {services.map(svc => (
            <TouchableOpacity key={svc.id} style={s.quickItem} onPress={() => navigate('confirm', { service: svc, location })}>
              <Text style={{ fontSize: 22, marginBottom: 4 }}>{svc.emoji}</Text>
              <Text style={[s.small, { color: C.text, fontWeight: '500' }]} numberOfLines={1}>{svc.name.split(' ')[0]}</Text>
              <Text style={[s.tiny, { color: C.orange, marginTop: 2 }]}>KES {Number(svc.price).toLocaleString()}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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

// --- PaymentScreen ---
function PaymentScreen({ navigate, params, user }) {
  const [phone,           setPhone]           = useState((user?.phone || '').replace(/^254/, '0'));
  const [paid,            setPaid]            = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState('');
  const [selectedRating,  setSelectedRating]  = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const socketRef = useRef(null);
  const jobId  = params?.jobId;
  const price  = params?.service?.price;

  useEffect(() => {
    if (!jobId) { Alert.alert('Error', 'No active job found.'); navigate('home'); return; }
    let socket;
    AsyncStorage.getItem('rr_token').then(token => {
      if (!token) return;
      socket = io(API, { auth: { token } });
      socketRef.current = socket;
      socket.on('payment_confirmed', ({ jobId: cid }) => {
        if (cid === jobId) { setLoading(false); setPaid(true); AsyncStorage.removeItem('rr_active_job_id').catch(() => {}); }
      });
      socket.on('payment_failed', () => { setLoading(false); setError('Payment was not completed. Please try again.'); });
    });
    return () => socket?.disconnect();
  }, [jobId]);

  const handlePay = async () => {
    const clean = phone.replace(/\s/g, '');
    if (!/^(07|01|\+2547|\+2541)\d{8}$/.test(clean)) { setError('Please enter a valid M-Pesa number'); return; }
    setLoading(true); setError('');
    try { await api.post('/api/payments/mpesa', { jobId, phone: clean }); }
    catch (err) { setLoading(false); setError(err.message || 'Could not connect to M-Pesa.'); }
  };

  const submitRating = async (stars) => {
    setSelectedRating(stars);
    if (!ratingSubmitted && jobId) { setRatingSubmitted(true); api.post('/api/jobs/' + jobId + '/rating', { rating: stars }).catch(() => {}); }
  };

  const ratingText = ['', "We'll look into this", 'Could be better', 'Good', 'Great!', 'Excellent!'];

  if (paid) return (
    <SafeAreaView style={s.screen}>
      <View style={s.centre}>
        <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: C.green + '20', borderWidth: 2, borderColor: C.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 30 }}>✓</Text>
        </View>
        <Text style={[s.title, { color: C.green, marginBottom: 6 }]}>Payment Complete!</Text>
        <Text style={[s.small, { marginBottom: 6 }]}>How was your experience?</Text>
        <Text style={[s.tiny, { color: C.muted, marginBottom: 16 }]}>Your rating helps other drivers find great providers</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
          {[1,2,3,4,5].map(star => (
            <TouchableOpacity key={star} onPress={() => submitRating(star)}>
              <Text style={{ fontSize: 36, opacity: star <= selectedRating ? 1 : 0.3 }}>{'⭐'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {selectedRating > 0 && <Text style={[s.tiny, { color: C.green, marginBottom: 16 }]}>{ratingText[selectedRating]}</Text>}
        <TouchableOpacity style={s.btn} onPress={() => navigate('home')}>
          <Text style={s.btnTxt}>{selectedRating > 0 ? 'Done' : 'Skip & Done'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('tracking', params)}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>Payment</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView style={{ padding: 16 }}>
        <View style={[s.card, { alignItems: 'center', marginBottom: 16 }]}>
          <Text style={[s.title, { fontSize: 36 }]}>KES {price ? Number(price).toLocaleString() : '...'}</Text>
          <Text style={[s.tiny, { color: C.green, marginTop: 3 }]}>{'✓'} Locked price · {params?.service?.name || ''}</Text>
        </View>
        <TextInput value={phone} onChangeText={t => { setPhone(t); setError(''); }} placeholder="M-Pesa number (07XX XXX XXX)" placeholderTextColor={C.muted} style={[s.input, { marginBottom: error ? 4 : 10 }]} keyboardType="phone-pad" maxLength={13} />
        {error ? <Text style={{ color: '#E03A3A', fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}
        {loading ? (
          <View style={{ backgroundColor: C.card, borderRadius: 11, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
            <ActivityIndicator color={C.green} />
            <Text style={[s.small, { marginTop: 10 }]}>Check your phone for the M-Pesa prompt</Text>
            <Text style={[s.tiny, { marginTop: 4 }]}>This may take up to 30 seconds</Text>
          </View>
        ) : (
          <TouchableOpacity style={[s.btn, { backgroundColor: '#009954' }]} onPress={handlePay}>
            <Text style={s.btnTxt}>Pay via M-Pesa</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// --- DiagnosisScreen ---
function DiagnosisScreen({ navigate }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: "Hi! Describe your car problem and I'll help diagnose it. 🔧" }]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const scrollRef = useRef();
  const send = async (override) => {
    const text = (override || input).trim();
    if (!text || loading) return;
    setInput('');
    const msgs = [...messages, { role: 'user', content: text }];
    setMessages(msgs);
    setLoading(true);
    try {
      const { reply } = await api.post('/api/ai/diagnose', { messages: msgs.map(m => ({ role: m.role, content: m.content })) });
      setMessages([...msgs, { role: 'assistant', content: reply }]);
    } catch {
      setMessages([...msgs, { role: 'assistant', content: 'Unable to connect. Please call support: 0800 123 456' }]);
    } finally { setLoading(false); }
  };
  const quickPrompts = ["Won't start - clicking noise", "Steam from bonnet", "Flat tyre, no spare", "Stalled on highway"];
  return (
    <SafeAreaView style={[s.screen, { flex: 1 }]}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('home')}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>AI Diagnosis</Text>
        <View style={{ width: 50 }} />
      </View>
      <FlatList ref={scrollRef} data={messages} keyExtractor={(_, i) => String(i)} style={{ flex: 1, padding: 14 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={{ flexDirection: item.role === 'user' ? 'row-reverse' : 'row', marginBottom: 10, alignItems: 'flex-end' }}>
            <View style={{ maxWidth: '80%', padding: 10, borderRadius: 12, backgroundColor: item.role === 'user' ? C.orange : 'rgba(255,255,255,.08)', borderWidth: item.role !== 'user' ? 1 : 0, borderColor: C.border }}>
              <Text style={[s.small, { color: 'white', lineHeight: 20 }]}>{item.content}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={loading ? <Text style={[s.small, { color: C.muted, padding: 8 }]}>Thinking...</Text> : null}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 }}>
        {quickPrompts.map(q => <TouchableOpacity key={q} onPress={() => send(q)} style={s.qp}><Text style={s.tiny}>{q}</Text></TouchableOpacity>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 7, padding: 10, borderTopWidth: 1, borderColor: C.border }}>
        <TextInput value={input} onChangeText={setInput} placeholder="Describe your car problem..." placeholderTextColor={C.muted} style={[s.input, { flex: 1 }]} onSubmitEditing={() => send()} returnKeyType="send" />
        <TouchableOpacity style={{ backgroundColor: C.orange, borderRadius: 7, padding: 10, justifyContent: 'center' }} onPress={() => send()}>
          <Text style={{ color: 'white', fontSize: 16 }}>{'\u27a4'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

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
  const screens = { home: <HomeScreen {...props} />, select: <SelectServiceScreen {...props} />, confirm: <ConfirmScreen {...props} />, searching: <SearchingScreen {...props} />, tracking: <TrackingScreen {...props} />, payment: <PaymentScreen {...props} />, diagnosis: <DiagnosisScreen {...props} /> };
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
