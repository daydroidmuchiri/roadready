import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Alert,
} from 'react-native';
import {
  useProviderLocationBroadcast, calculateETA,
} from '../../shared/useLocation';
import {
  RRMapView, JobLocationMarker, ProviderMarker,
  RoutePolyline, ETABadge, fitMapToCoords, decodePolyline,
} from '../../shared/MapComponents';

const MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY;
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// Shared s styles needed inside NavigatingScreen (btn, btnTxt, small, tiny)
const s = StyleSheet.create({
  btn:    { backgroundColor: '#E8631A', borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt: { color: 'white', fontSize: 15, fontWeight: '600' },
  small:  { fontSize: 12, color: '#7A8AA0' },
  tiny:   { fontSize: 11, color: '#7A8AA0' },
});

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

export default NavigatingScreen;
