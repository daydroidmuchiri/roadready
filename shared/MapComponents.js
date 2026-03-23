/**
 * RoadReady — Shared Map Components
 *
 * Components:
 *   <RRMapView />        — base map wrapper with dark Nairobi style
 *   <ProviderMarker />   — animated moving mechanic pin
 *   <MotoristMarker />   — breakdown location pin
 *   <RoutePolyline />    — driving route line between two points
 *   <ETABadge />         — floating ETA display on the map
 *
 * Uses react-native-maps (included with Expo).
 * Google Maps is used on Android, Apple Maps on iOS.
 * To force Google Maps on iOS too:
 *   set provider={PROVIDER_GOOGLE} on MapView
 *   and add your iOS Maps API key.
 *
 * Install:
 *   npx expo install react-native-maps
 *
 * app.json additions needed (already in our app.json files):
 *   android.googleServicesFile: './google-services.json'
 *
 * For the client-side Maps key (showing the map tiles):
 *   Set EXPO_PUBLIC_GOOGLE_MAPS_KEY in your .env
 *   This is different from GOOGLE_MAPS_SERVER_KEY (backend only)
 */

import React, { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Circle } from 'react-native-maps';

const C = {
  orange: '#E8631A', green: '#00A870', blue: '#1A7AE8',
  dark: '#060F1C', card: '#0C1828',
};

// ─── Dark map style (matches the app theme) ───────────────────────────────────
// Generated from Google Maps Styling Wizard — night mode tuned for Nairobi roads

const DARK_MAP_STYLE = [
  { elementType: 'geometry',       stylers: [{ color: '#0C1828' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A8AA0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#060F1C' }] },
  { featureType: 'road',           elementType: 'geometry',       stylers: [{ color: '#152030' }] },
  { featureType: 'road',           elementType: 'geometry.stroke', stylers: [{ color: '#0C1828' }] },
  { featureType: 'road.highway',   elementType: 'geometry',       stylers: [{ color: '#1A2E45' }] },
  { featureType: 'road.highway',   elementType: 'geometry.stroke', stylers: [{ color: '#152030' }] },
  { featureType: 'road.highway',   elementType: 'labels.text.fill', stylers: [{ color: '#ECF0F7' }] },
  { featureType: 'water',          elementType: 'geometry',       stylers: [{ color: '#060F1C' }] },
  { featureType: 'poi',            elementType: 'labels',         stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',        elementType: 'labels',         stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry',       stylers: [{ color: '#152030' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

// ─── RRMapView ────────────────────────────────────────────────────────────────

export function RRMapView({
  children,
  initialRegion,
  style,
  onMapReady,
  showsUserLocation = false,
  followsUserLocation = false,
  mapRef,
}) {
  const defaultRegion = initialRegion || {
    latitude:      -1.2921,    // Nairobi
    longitude:      36.8219,
    latitudeDelta:  0.05,
    longitudeDelta: 0.05,
  };

  return (
    <MapView
      ref={mapRef}
      style={[{ flex: 1 }, style]}
      provider={PROVIDER_GOOGLE}
      customMapStyle={DARK_MAP_STYLE}
      initialRegion={defaultRegion}
      showsUserLocation={showsUserLocation}
      followsUserLocation={followsUserLocation}
      showsMyLocationButton={false}
      showsCompass={false}
      showsScale={false}
      showsTraffic={false}
      toolbarEnabled={false}
      mapPadding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      onMapReady={onMapReady}
    >
      {children}
    </MapView>
  );
}

// ─── ProviderMarker ───────────────────────────────────────────────────────────
// The moving mechanic pin — shows rotation based on heading

export function ProviderMarker({ location, heading, providerName }) {
  if (!location?.lat || !location?.lng) return null;

  return (
    <Marker
      coordinate={{ latitude: location.lat, longitude: location.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      flat
      rotation={heading || 0}
      tracksViewChanges={false}
    >
      <View style={pm.container}>
        <View style={pm.outer}>
          <View style={pm.inner}>
            <Text style={pm.icon}>🔧</Text>
          </View>
        </View>
        <View style={pm.label}>
          <Text style={pm.labelTxt} numberOfLines={1}>{providerName || 'Mechanic'}</Text>
        </View>
      </View>
    </Marker>
  );
}

const pm = StyleSheet.create({
  container: { alignItems: 'center' },
  outer:     { width: 44, height: 44, borderRadius: 22, backgroundColor: C.green + '30', borderWidth: 2, borderColor: C.green, alignItems: 'center', justifyContent: 'center' },
  inner:     { width: 32, height: 32, borderRadius: 16, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 16 },
  label:     { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 3, maxWidth: 110 },
  labelTxt:  { fontSize: 10, color: '#ECF0F7', fontWeight: '600' },
});

// ─── MotoristMarker ───────────────────────────────────────────────────────────
// The breakdown location pin with animated pulse

export function MotoristMarker({ location, label }) {
  if (!location?.lat || !location?.lng) return null;

  return (
    <Marker
      coordinate={{ latitude: location.lat, longitude: location.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
    >
      <View style={mm.container}>
        <View style={mm.outer}>
          <View style={mm.inner}>
            <Text style={mm.icon}>🚗</Text>
          </View>
        </View>
        {label && (
          <View style={mm.label}>
            <Text style={mm.labelTxt} numberOfLines={1}>{label}</Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

const mm = StyleSheet.create({
  container: { alignItems: 'center' },
  outer:     { width: 44, height: 44, borderRadius: 22, backgroundColor: C.orange + '30', borderWidth: 2, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  inner:     { width: 32, height: 32, borderRadius: 16, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 16 },
  label:     { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 3, maxWidth: 110 },
  labelTxt:  { fontSize: 10, color: '#ECF0F7', fontWeight: '600' },
});

// ─── JobLocationMarker ────────────────────────────────────────────────────────
// Used on provider's navigation screen — the destination pin

export function JobLocationMarker({ location, address }) {
  if (!location?.lat || !location?.lng) return null;
  return (
    <Marker
      coordinate={{ latitude: location.lat, longitude: location.lng }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
    >
      <View style={jm.container}>
        <View style={jm.pin}>
          <Text style={{ fontSize: 18 }}>📍</Text>
        </View>
        {address && (
          <View style={jm.label}>
            <Text style={jm.labelTxt} numberOfLines={2}>{address}</Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

const jm = StyleSheet.create({
  container: { alignItems: 'center', maxWidth: 150 },
  pin:       { width: 36, height: 36, borderRadius: 18, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'white' },
  label:     { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 3 },
  labelTxt:  { fontSize: 10, color: '#ECF0F7', textAlign: 'center' },
});

// ─── RoutePolyline ────────────────────────────────────────────────────────────
// Draws the driving route between provider and motorist.
// coords is an array of { latitude, longitude } objects
// decoded from the Google Directions API polyline.

export function RoutePolyline({ coords, color }) {
  if (!coords?.length) return null;
  return (
    <Polyline
      coordinates={coords}
      strokeColor={color || C.blue}
      strokeWidth={4}
      lineDashPattern={null}
      lineJoin="round"
      lineCap="round"
    />
  );
}

// ─── ETABadge ─────────────────────────────────────────────────────────────────
// Floating card overlaid on the map showing live ETA

export function ETABadge({ minutes, distanceKm, isLive }) {
  return (
    <View style={eb.badge}>
      <View style={eb.row}>
        {isLive && <View style={eb.liveDot} />}
        <Text style={eb.eta}>{minutes} min</Text>
      </View>
      <Text style={eb.dist}>{distanceKm} km away</Text>
    </View>
  );
}

const eb = StyleSheet.create({
  badge:   { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#152030', shadowColor: '#000', shadowOpacity: .3, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.green },
  eta:     { fontSize: 22, fontWeight: '700', color: C.orange },
  dist:    { fontSize: 11, color: '#7A8AA0', marginTop: 2 },
});

// ─── fitMapToCoords ───────────────────────────────────────────────────────────
// Call on a MapView ref to automatically zoom to fit two pins with padding.

export function fitMapToCoords(mapRef, coords, padding = 80) {
  if (!mapRef?.current || coords.length < 2) return;
  mapRef.current.fitToCoordinates(
    coords.map(c => ({ latitude: c.lat, longitude: c.lng })),
    {
      edgePadding: { top: padding, right: padding, bottom: padding + 100, left: padding },
      animated: true,
    }
  );
}

// ─── decodePolyline ───────────────────────────────────────────────────────────
// Google Maps encodes route paths as a compressed polyline string.
// This decodes it to an array of { latitude, longitude } for Polyline component.

export function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}
