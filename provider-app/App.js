/**
 * RoadReady Provider App — with Google Maps Navigation
 * React Native (Expo)
 *
 * Map screens:
 *   NavigatingScreen  — full-screen map + turn-by-turn nav to job location
 *                       broadcasts live GPS to motorist via WebSocket
 *
 * Install additions:
 *   npx expo install react-native-maps expo-location
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Switch, Animated, Modal, SafeAreaView, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { io } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNotifications, registerTokenAfterLogin, clearBadge,
  scheduleLocalNotification, cancelLocalNotification,
} from '../shared/useNotifications';
import {
  useProviderBackgroundServices,
  enqueueOfflineAction,
} from '../shared/backgroundServices';
import { AuthFlow, useAuth } from '../shared/AuthScreens';
import { initSentry, captureException, setUser } from '../shared/sentry';
import { usePhotoUpload } from '../shared/usePhotoUpload';
import {
  useProviderLocationBroadcast, calculateETA,
} from '../shared/useLocation';
import {
  RRMapView, JobLocationMarker, ProviderMarker,
  RoutePolyline, ETABadge, fitMapToCoords, decodePolyline,
} from '../shared/MapComponents';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// ─── Directions API helper ────────────────────────────────────────────────────
// Fetches a driving route from provider's location to the job.
// Returns decoded polyline coordinates for the RoutePolyline component.

async function getDirections(originLat, originLng, destLat, destLng) {
  if (!MAPS_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=driving&region=ke&departure_time=now&key=${MAPS_KEY}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' || !data.routes?.length) return null;
    return decodePolyline(data.routes[0].overview_polyline.points);
  } catch {
    return null;
  }
}

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

// ─── Job Alert Modal ──────────────────────────────────────────────────────────
function JobAlertModal({ job, onAccept, onDecline }) {
  const [timeLeft, setTimeLeft] = useState(job?.expiresInSeconds || 60);
  const slideAnim  = useRef(new Animated.Value(400)).current;
  const expiryRef  = useRef(null);

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 8, useNativeDriver: true }).start();
    scheduleLocalNotification('Job alert expiring!', `10 seconds left to accept ${job?.serviceName}`, 50)
      .then(id => { expiryRef.current = id; });

    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); onDecline(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { clearInterval(timer); if (expiryRef.current) cancelLocalNotification(expiryRef.current); };
  }, []);

  if (!job) return null;
  const urgency = timeLeft <= 10 ? '#E03A3A' : timeLeft <= 20 ? C.yellow : C.orange;

  return (
    <Modal transparent animationType="none" statusBarTranslucent>
      <View style={ja.overlay}>
        <Animated.View style={[ja.panel, { transform: [{ translateY: slideAnim }] }]}>
          <View style={ja.hdr}>
            <View style={[ja.dot, { backgroundColor: urgency }]} />
            <Text style={[ja.lbl, { color: urgency }]}>NEW JOB AVAILABLE</Text>
            <View style={[ja.pill, { backgroundColor: urgency + '20', borderColor: urgency + '50' }]}>
              <Text style={[ja.pillTxt, { color: urgency }]}>{timeLeft}s</Text>
            </View>
          </View>
          <View style={ja.box}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={ja.svcName}>{job.serviceEmoji} {job.serviceName}</Text>
                <Text style={ja.addr}>📍 {job.address}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Text style={ja.meta}>{job.distanceKm?.toFixed(1)}km</Text>
                  <Text style={ja.meta}>·</Text>
                  <Text style={ja.meta}>~{Math.round((job.distanceKm / 30) * 60)} min</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={ja.earn}>KES {job.providerEarning?.toLocaleString()}</Text>
                <Text style={ja.earnLbl}>you earn</Text>
              </View>
            </View>
          </View>
          <View style={ja.btns}>
            <TouchableOpacity style={ja.btnNo} onPress={onDecline}>
              <Text style={ja.btnNoTxt}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ja.btnYes, { backgroundColor: urgency }]} onPress={onAccept}>
              <Text style={ja.btnYesTxt}>Accept Job ›</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── NavigatingScreen ─────────────────────────────────────────────────────────
// Full-screen map. Provider's GPS broadcasts to motorist via WebSocket.
// Route polyline redraws as the provider moves.

function NavigatingScreen({ navigate, params, socket }) {
  const mapRef = useRef(null);
  const job    = params?.job;

  const jobLocation = job
    ? { lat: job.lat, lng: job.lng }
    : { lat: -1.2633, lng: 36.8035 };

  // Broadcast GPS location via WebSocket while navigating
  const { currentLocation, permissionLevel } = useProviderLocationBroadcast({
    socket,
    isActive: true,
    jobId: job?.id,
  });

  const [eta,         setEta]         = useState({ minutes: 14, distanceKm: 2.1 });
  const [routeCoords, setRouteCoords] = useState([]);
  const [arrived,     setArrived]     = useState(false);

  // Fetch route + recalculate ETA when position changes
  useEffect(() => {
    if (!currentLocation) return;

    calculateETA(currentLocation.lat, currentLocation.lng, jobLocation.lat, jobLocation.lng)
      .then(result => {
        setEta(result);
        // Auto-arrive when within 50 metres
        if (result.distanceKm < 0.05) setArrived(true);
      }).catch(() => {});

    getDirections(currentLocation.lat, currentLocation.lng, jobLocation.lat, jobLocation.lng)
      .then(coords => { if (coords) setRouteCoords(coords); })
      .catch(() => {});
  }, [currentLocation]);

  // Fit map to show both provider and job pins
  useEffect(() => {
    if (!currentLocation) return;
    fitMapToCoords(mapRef, [currentLocation, jobLocation]);
  }, [currentLocation?.lat]);

  // Background permission warning
  useEffect(() => {
    if (permissionLevel === 'foreground') {
      Alert.alert(
        'Location tracking limited',
        'RoadReady will not track your location when the screen is locked. To enable background tracking, allow "Always" location access in Settings.',
        [{ text: 'OK' }, { text: 'Open Settings' }]
      );
    }
  }, [permissionLevel]);

  const checklist = [
    { done: true,  txt: 'Greet customer and verify name' },
    { done: true,  txt: 'Inspect the problem' },
    { curr: true,  txt: 'Begin repair / service' },
    { done: false, txt: 'Complete sign-off in app' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: C.dark }}>
      {/* Full screen map */}
      <RRMapView
        mapRef={mapRef}
        style={{ flex: 1 }}
        initialRegion={{
          latitude:       jobLocation.lat,
          longitude:      jobLocation.lng,
          latitudeDelta:  0.04,
          longitudeDelta: 0.04,
        }}
        showsUserLocation={false}
      >
        {/* Job destination pin */}
        <JobLocationMarker location={jobLocation} address={job?.address} />

        {/* Provider's own live location */}
        {currentLocation && (
          <ProviderMarker
            location={currentLocation}
            heading={currentLocation.heading}
            providerName="You"
          />
        )}

        {/* Route polyline */}
        {routeCoords.length > 0 && (
          <RoutePolyline coords={routeCoords} color={C.blue} />
        )}
      </RRMapView>

      {/* ETA floating badge */}
      <View style={ns.etaWrap}>
        <ETABadge
          minutes={eta.minutes}
          distanceKm={eta.distanceKm}
          isLive={!!currentLocation}
        />
      </View>

      {/* Live tracking indicator */}
      {currentLocation && (
        <View style={ns.liveChip}>
          <View style={ns.liveDot} />
          <Text style={ns.liveTxt}>Broadcasting location to motorist</Text>
        </View>
      )}

      {/* Bottom panel */}
      <SafeAreaView style={ns.panel}>
        {/* Customer info */}
        <View style={ns.custCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={ns.custName}>{job?.motoristName || 'Alice Njoroge'}</Text>
              <Text style={ns.custAddr} numberOfLines={1}>📍 {job?.address || 'Parklands Rd, Westlands'}</Text>
              <Text style={ns.custSvc}>{job?.serviceEmoji || '🔋'} {job?.serviceName || 'Battery Jumpstart'}</Text>
            </View>
            <Text style={ns.earning}>KES {job?.providerEarning?.toLocaleString() || '760'}</Text>
          </View>
          <View style={ns.actions}>
            {['📞 Call', '💬 Chat', '⚠️ Issue'].map(a => (
              <TouchableOpacity key={a} style={ns.actionBtn}>
                <Text style={s.tiny}>{a}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Arrived? Show checklist. Not arrived? Show navigation CTA. */}
        {arrived ? (
          <>
            <Text style={[s.small, { fontWeight: '600', color: C.text, marginBottom: 8 }]}>On-Site Checklist</Text>
            {checklist.map((item, i) => (
              <View key={i} style={[ns.ckItem, item.curr && { backgroundColor: 'rgba(232,99,26,.07)', borderColor: 'rgba(232,99,26,.25)' }]}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: item.done ? C.green + '30' : item.curr ? C.orange + '30' : C.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 9, color: item.done ? C.green : item.curr ? C.orange : C.muted }}>{item.done ? '✓' : i + 1}</Text>
                </View>
                <Text style={[s.small, { flex: 1, marginLeft: 8, color: item.done ? C.muted : C.text, textDecorationLine: item.done ? 'line-through' : 'none' }]}>{item.txt}</Text>
              </View>
            ))}
            <TouchableOpacity style={[s.btn, { backgroundColor: C.green, marginTop: 12 }]} onPress={() => navigate('done', { job })}>
              <Text style={s.btnTxt}>Mark Job Complete ✓</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[s.btn, { backgroundColor: C.green }]} onPress={() => setArrived(true)}>
            <Text style={s.btnTxt}>I've Arrived at Location</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

const ns = StyleSheet.create({
  etaWrap:    { position: 'absolute', top: 55, alignSelf: 'center' },
  liveChip:   { position: 'absolute', top: 55, right: 14, backgroundColor: C.card, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: C.green + '40' },
  liveDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  liveTxt:    { fontSize: 10, color: C.green },
  panel:      { backgroundColor: C.dark, borderTopWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 12 },
  custCard:   { backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  custName:   { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  custAddr:   { fontSize: 11, color: C.muted, marginBottom: 2 },
  custSvc:    { fontSize: 11, color: C.muted },
  earning:    { fontSize: 17, fontWeight: '700', color: C.orange },
  actions:    { flexDirection: 'row', gap: 7, marginTop: 10 },
  actionBtn:  { flex: 1, backgroundColor: 'rgba(255,255,255,.04)', borderWidth: 1, borderColor: C.border, borderRadius: 7, padding: 7, alignItems: 'center' },
  ckItem:     { flexDirection: 'row', alignItems: 'center', padding: 9, borderWidth: 1, borderColor: C.border, borderRadius: 9, marginBottom: 6, backgroundColor: C.card },
});

// ─── OnboardingScreen ────────────────────────────────────────────────────────
function OnboardingScreen({ navigate }) {
  const { upload, capture, uploading, progress, error, setError } = usePhotoUpload();
  const [profile, setProfile] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [success, setSuccess] = React.useState('');

  React.useEffect(() => {
    AsyncStorage.getItem('rr_token').then(token => {
      fetch(`${API}/api/providers/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => { setProfile(data.profile || {}); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const handleUpload = async (uploadType, useCamera = false) => {
    setSuccess(''); setError('');
    const result = useCamera
      ? await capture(uploadType)
      : await upload(uploadType);
    if (result?.url) {
      setSuccess(uploadType === 'id_doc' ? 'ID photo uploaded ✓' : 'Equipment photo uploaded ✓');
      setProfile(prev => ({
        ...prev,
        idDocUrl:        uploadType === 'id_doc'    ? result.url : prev?.idDocUrl,
        equipmentDocUrl: uploadType === 'equipment' ? result.url : prev?.equipmentDocUrl,
      }));
    }
  };

  const steps = [
    { n: 'Phone Verified',    s: 'Completed via OTP',        done: true,                   key: 'phone'     },
    { n: 'ID Verification',   s: profile?.idDocUrl ? 'Uploaded ✓' : 'Upload your national ID', done: !!profile?.idDocUrl, curr: !profile?.idDocUrl, key: 'id_doc' },
    { n: 'Equipment Check',   s: profile?.equipmentDocUrl ? 'Uploaded ✓' : 'Upload photo of your tools', done: !!profile?.equipmentDocUrl, curr: !!profile?.idDocUrl && !profile?.equipmentDocUrl, key: 'equipment' },
    { n: 'Background Check',  s: profile?.backgroundCheck ? 'Cleared ✓' : 'Pending review (1–2 days)', done: !!profile?.backgroundCheck, key: null },
    { n: 'Training',          s: profile?.trainingDone   ? 'Completed ✓' : '3-hour online course',    done: !!profile?.trainingDone,    key: null },
    { n: 'Go Live!',          s: profile?.onboardStatus === 'approved' ? "You're live!" : 'Complete steps above', done: profile?.onboardStatus === 'approved', key: null },
  ];

  const completed = steps.filter(s => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  if (loading) return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C', alignItems:'center', justifyContent:'center' }}>
      <ActivityIndicator color="#E8631A" />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C' }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingBottom:10 }}>
        <Text style={{ fontSize:15, fontWeight:'600', color:'#ECF0F7' }}>Provider Onboarding</Text>
        <Text style={{ fontSize:12, color:'#E8631A' }}>{pct}% complete</Text>
      </View>
      <ScrollView style={{ padding:16 }}>
        {/* Progress bar */}
        <View style={{ height:4, backgroundColor:'#0C1828', borderRadius:2, marginBottom:16 }}>
          <View style={{ height:4, backgroundColor:'#E8631A', borderRadius:2, width: pct+'%' }} />
        </View>

        {error  ? <View style={{ backgroundColor:'rgba(224,58,58,.1)', borderWidth:1, borderColor:'rgba(224,58,58,.3)', borderRadius:9, padding:10, marginBottom:10 }}><Text style={{ color:'#E03A3A', fontSize:12 }}>{error}</Text></View>  : null}
        {success? <View style={{ backgroundColor:'rgba(0,168,112,.1)', borderWidth:1, borderColor:'rgba(0,168,112,.3)', borderRadius:9, padding:10, marginBottom:10 }}><Text style={{ color:'#00A870', fontSize:12 }}>{success}</Text></View> : null}

        {uploading && (
          <View style={{ backgroundColor:'#0C1828', borderWidth:1, borderColor:'#152030', borderRadius:9, padding:10, marginBottom:10, flexDirection:'row', alignItems:'center', gap:10 }}>
            <ActivityIndicator color="#E8631A" size="small" />
            <Text style={{ color:'#E8631A', fontSize:12 }}>Uploading... {progress}%</Text>
          </View>
        )}

        {steps.map((step, i) => (
          <View key={i} style={{
            flexDirection:'row', alignItems:'center', padding:12,
            borderWidth:1,
            borderColor: step.curr ? 'rgba(232,99,26,.35)' : step.done ? 'rgba(0,168,112,.25)' : '#152030',
            borderRadius:10, marginBottom:8,
            backgroundColor: step.curr ? 'rgba(232,99,26,.07)' : step.done ? 'rgba(0,168,112,.05)' : '#0C1828',
          }}>
            <View style={{
              width:24, height:24, borderRadius:12, marginRight:10,
              alignItems:'center', justifyContent:'center',
              backgroundColor: step.done ? 'rgba(0,168,112,.2)' : step.curr ? 'rgba(232,99,26,.2)' : '#152030',
            }}>
              <Text style={{ fontSize:10, color: step.done ? '#00A870' : step.curr ? '#E8631A' : '#7A8AA0' }}>
                {step.done ? '✓' : i+1}
              </Text>
            </View>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:12, fontWeight:'600', color:'#ECF0F7' }}>{step.n}</Text>
              <Text style={{ fontSize:10, marginTop:2, color: step.done ? '#00A870' : '#7A8AA0' }}>{step.s}</Text>
            </View>
            {/* Upload buttons for ID and equipment steps */}
            {step.key && !step.done && (
              <View style={{ flexDirection:'row', gap:6 }}>
                <TouchableOpacity
                  onPress={() => handleUpload(step.key, false)}
                  disabled={uploading}
                  style={{ backgroundColor:'rgba(232,99,26,.15)', borderWidth:1, borderColor:'rgba(232,99,26,.3)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                  <Text style={{ color:'#E8631A', fontSize:10 }}>📁 Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleUpload(step.key, true)}
                  disabled={uploading}
                  style={{ backgroundColor:'rgba(232,99,26,.15)', borderWidth:1, borderColor:'rgba(232,99,26,.3)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                  <Text style={{ color:'#E8631A', fontSize:10 }}>📷 Camera</Text>
                </TouchableOpacity>
              </View>
            )}
            {step.key && step.done && (
              <TouchableOpacity
                onPress={() => handleUpload(step.key, false)}
                disabled={uploading}
                style={{ backgroundColor:'rgba(0,168,112,.1)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                <Text style={{ color:'#00A870', fontSize:10 }}>Re-upload</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {profile?.onboardStatus !== 'approved' && (
          <View style={{ backgroundColor:'rgba(26,122,232,.08)', borderWidth:1, borderColor:'rgba(26,122,232,.2)', borderRadius:10, padding:12, marginTop:4 }}>
            <Text style={{ color:'#1A7AE8', fontSize:12, fontWeight:'600', marginBottom:4 }}>What happens after upload?</Text>
            <Text style={{ color:'#7A8AA0', fontSize:11, lineHeight:17 }}>
              Our team reviews your documents within 24–48 hours. You'll receive a push notification when your account is approved and you can start accepting jobs.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── DashboardScreen ──────────────────────────────────────────────────────────
function DashboardScreen({ navigate, isOnline, onToggle, onSimulate, dashData }) {
  const { todayEarnings, todayJobs, totalJobs, rating, recentJobs, loading, refresh } = dashData;

  const emojiFor = (serviceId) => ({
    jumpstart: '🔋', tyre: '🛞', fuel: '⛽', towing: '🚛', lockout: '🔑',
  }[serviceId] || '🔧');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.dark }}>
      <ScrollView>
        <View style={s.hdr}>
          <View>
            <Text style={s.sub}>Provider App</Text>
            <Text style={s.logo}>Road<Text style={{ color: C.green }}>Ready</Text></Text>
          </View>
          <TouchableOpacity onPress={refresh} style={{ padding: 6 }}>
            <Text style={{ color: C.muted, fontSize: 13 }}>↻</Text>
          </TouchableOpacity>
        </View>

        <View style={s.statusRow}>
          <View>
            <Text style={[s.body, { color: isOnline ? C.green : C.muted, fontWeight: '600' }]}>{isOnline ? '● Online' : '○ Offline'}</Text>
            <Text style={s.tiny}>{isOnline ? 'Accepting jobs' : 'Tap to go online'}</Text>
          </View>
          <Switch value={isOnline} onValueChange={onToggle} trackColor={{ false: C.border, true: C.green }} thumbColor="white" />
        </View>

        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <ActivityIndicator color={C.orange} />
            <Text style={[s.tiny, { marginTop: 8 }]}>Loading your stats...</Text>
          </View>
        ) : (
          <>
            <View style={s.grid}>
              {[
                [`KES ${Number(todayEarnings).toLocaleString()}`, "Today's earnings", C.green],
                [String(todayJobs),                               'Jobs today',       C.blue  ],
                [`⭐ ${rating}`,                                   'Your rating',      C.yellow],
                [String(totalJobs),                               'Total jobs',       C.orange],
              ].map(([v, l, c]) => (
                <View key={l} style={s.statCard}>
                  <Text style={[s.body, { fontWeight: '700', color: c }]}>{v}</Text>
                  <Text style={s.tiny}>{l}</Text>
                </View>
              ))}
            </View>

            <Text style={s.secTitle}>Recent Jobs</Text>
            {recentJobs.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 28, marginBottom: 8 }}>🔧</Text>
                <Text style={[s.small, { color: C.muted, textAlign: 'center' }]}>No jobs yet — go online to start accepting</Text>
              </View>
            ) : recentJobs.map(job => (
              <View key={job.id} style={s.jobRow}>
                <Text style={{ fontSize: 22 }}>{job.serviceEmoji || emojiFor(job.serviceId)}</Text>
                <View style={{ flex: 1, marginLeft: 9 }}>
                  <Text style={[s.small, { fontWeight: '600', color: C.text }]}>
                    {job.serviceName || job.serviceId}
                  </Text>
                  <Text style={s.tiny} numberOfLines={1}>
                    {job.address ? job.address.split(',')[0] : ''} · {(job.status || '').replace('_', ' ')}
                  </Text>
                </View>
                {job.status === 'completed' && (
                  <Text style={[s.body, { color: C.green, fontWeight: '600' }]}>
                    +{Number(job.providerEarning || 0).toLocaleString()}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}

        <TouchableOpacity style={s.simBtn} onPress={onSimulate}>
          <Text style={{ fontSize: 16 }}>🎯</Text>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={[s.small, { color: C.orange, fontWeight: '600' }]}>Simulate job alert</Text>
            <Text style={s.tiny}>Opens job alert with navigation</Text>
          </View>
          <Text style={{ color: C.orange }}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── DoneScreen ───────────────────────────────────────────────────────────────
function DoneScreen({ navigate, params }) {
  const earning = params?.job?.providerEarning;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.dark, padding: 16 }}>
      <View style={{ backgroundColor: 'rgba(0,168,112,.08)', borderWidth: 1, borderColor: 'rgba(0,168,112,.2)', borderRadius: 13, padding: 18, alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ fontSize: 36, marginBottom: 9 }}>✅</Text>
        <Text style={[s.title, { color: C.green }]}>
          {earning ? `KES ${Number(earning).toLocaleString()} earned` : 'Job Complete!'}
        </Text>
        <Text style={s.tiny}>Payout in 48 hours via M-Pesa</Text>
      </View>
      <TouchableOpacity style={[s.btn, { backgroundColor: C.green }]} onPress={() => navigate('dashboard')}>
        <Text style={s.btnTxt}>Back to Dashboard</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── PayoutsScreen ───────────────────────────────────────────────────────────────
function PayoutsScreen({ navigate }) {
  const [pending,  setPending]  = React.useState(null);
  const [history,  setHistory]  = React.useState([]);
  const [phone,    setPhone]    = React.useState('');
  const [loading,  setLoading]  = React.useState(true);
  const [paying,   setPaying]   = React.useState(false);
  const [error,    setError]    = React.useState('');
  const [success,  setSuccess]  = React.useState('');

  React.useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('rr_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [pendingRes, historyRes] = await Promise.all([
        fetch(`${API}/api/payouts/me/pending`, { headers }).then(r => r.json()),
        fetch(`${API}/api/payouts/me`,         { headers }).then(r => r.json()),
      ]);
      setPending(pendingRes);
      setHistory(Array.isArray(historyRes) ? historyRes : []);
    } catch { setError('Could not load payout data'); }
    finally   { setLoading(false); }
  };

  const requestPayout = async () => {
    if (!phone || !/^(07|01)\d{8}$/.test(phone.replace(/\s/g,''))) {
      setError('Enter a valid M-Pesa number'); return;
    }
    setPaying(true); setError(''); setSuccess('');
    try {
      const token = await AsyncStorage.getItem('rr_token');
      const res   = await fetch(`${API}/api/payouts/request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ mpesaPhone: phone.replace(/\s/g,'') }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message || 'Payout failed'); return; }
      setSuccess(data.message);
      await loadData();
    } catch { setError('Network error. Try again.'); }
    finally   { setPaying(false); }
  };

  const C2 = { orange: '#E8631A', green: '#00A870', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0' };

  if (loading) return (
    <SafeAreaView style={{ flex:1, backgroundColor: '#060F1C', alignItems:'center', justifyContent:'center' }}>
      <ActivityIndicator color="#E8631A" />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C' }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingBottom:10 }}>
        <Text style={{ fontSize:15, fontWeight:'600', color:C2.text }}>Earnings & Payouts</Text>
      </View>
      <ScrollView style={{ padding:16 }}>
        {/* Pending earnings */}
        <View style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:13, padding:16, marginBottom:14 }}>
          <Text style={{ fontSize:12, color:C2.muted, marginBottom:4 }}>Pending earnings</Text>
          <Text style={{ fontSize:32, fontWeight:'700', color:C2.green }}>KES {(pending?.totalPending||0).toLocaleString()}</Text>
          <Text style={{ fontSize:11, color:C2.muted, marginTop:3 }}>{pending?.jobCount||0} completed job{pending?.jobCount!==1?'s':''} not yet paid out</Text>
        </View>

        {/* Request payout */}
        {(pending?.totalPending||0) >= 100 && (
          <View style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:13, padding:16, marginBottom:14 }}>
            <Text style={{ fontSize:13, fontWeight:'600', color:C2.text, marginBottom:10 }}>Request Payout</Text>
            <TextInput
              value={phone} onChangeText={setPhone}
              placeholder="M-Pesa number (07XX XXX XXX)"
              placeholderTextColor={C2.muted}
              keyboardType="phone-pad"
              style={{ backgroundColor:'#060F1C', borderWidth:1, borderColor:C2.border, borderRadius:9, padding:'11px 13px', color:C2.text, fontSize:14, marginBottom:10 }}
            />
            {error  ? <Text style={{ color:'#E03A3A', fontSize:12, marginBottom:8  }}>{error}</Text>  : null}
            {success? <Text style={{ color:C2.green,  fontSize:12, marginBottom:8  }}>{success}</Text>: null}
            <TouchableOpacity
              style={{ backgroundColor:C2.green, borderRadius:11, padding:13, alignItems:'center', opacity:paying?0.6:1 }}
              onPress={requestPayout} disabled={paying}
            >
              {paying ? <ActivityIndicator color="white" /> : <Text style={{ color:'white', fontSize:14, fontWeight:'600' }}>Request KES {(pending?.totalPending||0).toLocaleString()} via M-Pesa</Text>}
            </TouchableOpacity>
            <Text style={{ fontSize:11, color:C2.muted, textAlign:'center', marginTop:8 }}>Payouts sent within 48 hours</Text>
          </View>
        )}

        {/* Payout history */}
        {history.length > 0 && (
          <>
            <Text style={{ fontSize:13, fontWeight:'600', color:C2.text, marginBottom:9 }}>Payout History</Text>
            {history.map((p, i) => (
              <View key={p.id||i} style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:10, padding:'10px 13px', marginBottom:7, flexDirection:'row', alignItems:'center' }}>
                <View style={{ flex:1 }}>
                  <Text style={{ fontSize:14, fontWeight:'600', color:C2.green }}>KES {(p.amount||0).toLocaleString()}</Text>
                  <Text style={{ fontSize:11, color:C2.muted, marginTop:2 }}>{p.jobCount} jobs · {new Date(p.initiatedAt).toLocaleDateString()}</Text>
                  {p.mpesaReceipt && <Text style={{ fontSize:10, color:C2.muted }}>Ref: {p.mpesaReceipt}</Text>}
                </View>
                <View style={{ backgroundColor: p.status==='completed'?'rgba(0,168,112,.15)':'rgba(212,154,10,.15)', borderRadius:6, paddingHorizontal:8, paddingVertical:3 }}>
                  <Text style={{ fontSize:10, fontWeight:'600', color: p.status==='completed'?C2.green:'#D49A0A' }}>{(p.status||'').toUpperCase()}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {history.length === 0 && !pending?.totalPending && (
          <View style={{ alignItems:'center', padding:32 }}>
            <Text style={{ fontSize:32, marginBottom:12 }}>💰</Text>
            <Text style={{ fontSize:15, color:C2.text, marginBottom:6 }}>No payouts yet</Text>
            <Text style={{ fontSize:12, color:C2.muted, textAlign:'center' }}>Complete jobs to start earning. Payouts are processed every 48 hours.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function ProviderApp() {
  const { user, loading } = useAuth();
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
    return <AuthFlow role="provider" onAuthenticated={() => {}} />;
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

  const mockJob = {
    id: 'J1099', serviceId: 'jumpstart', serviceName: 'Battery Jumpstart',
    serviceEmoji: '🔋', address: 'Parklands Rd, Westlands', motoristName: 'Alice Njoroge',
    lat: -1.2633, lng: 36.8035, price: 900, providerEarning: 760,
    distanceKm: 1.4, expiresInSeconds: 60,
  };

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
const ja = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,.88)', justifyContent: 'flex-end' },
  panel:    { backgroundColor: '#0C1826', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: 'rgba(232,99,26,.3)' },
  hdr:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dot:      { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  lbl:      { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
  pill:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  pillTxt:  { fontSize: 13, fontWeight: '700' },
  box:      { backgroundColor: '#060F1C', borderRadius: 12, padding: 13, marginBottom: 14 },
  svcName:  { fontSize: 15, fontWeight: '600', color: '#ECF0F7', marginBottom: 4 },
  addr:     { fontSize: 11, color: '#7A8AA0', marginBottom: 4 },
  meta:     { fontSize: 11, color: '#7A8AA0' },
  earn:     { fontSize: 20, fontWeight: '700', color: '#E8631A' },
  earnLbl:  { fontSize: 10, color: '#7A8AA0', marginTop: 2 },
  btns:     { flexDirection: 'row', gap: 10 },
  btnNo:    { flex: 1, backgroundColor: '#060F1C', borderWidth: 1, borderColor: '#152030', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnNoTxt: { fontSize: 14, fontWeight: '600', color: '#7A8AA0' },
  btnYes:   { flex: 2, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnYesTxt:{ fontSize: 15, fontWeight: '700', color: 'white' },
});

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
