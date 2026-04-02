import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, ActivityIndicator, SafeAreaView,
} from 'react-native';
import { useCurrentLocation } from '../../shared/useLocation';
import {
  RRMapView, MotoristMarker,
} from '../../shared/MapComponents';
import useServices from '../hooks/useServices';

const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

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
  body:         { fontSize: 14, color: C.muted },
  small:        { fontSize: 12, color: C.muted },
  tiny:         { fontSize: 11, color: C.muted },
  iconBtn:      { width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
});

export default HomeScreen;
