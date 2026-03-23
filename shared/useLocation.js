/**
 * RoadReady — useLocation hook
 *
 * Handles everything location-related:
 *   1. Permission requests (foreground + background)
 *   2. One-shot "get current location" for job creation
 *   3. Continuous foreground tracking (motorist tracking screen)
 *   4. Background location for providers driving to jobs
 *   5. Reverse geocoding (lat/lng → address string)
 *   6. Broadcasting provider location via WebSocket
 *
 * Install:
 *   npx expo install expo-location
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// How often providers broadcast their location (milliseconds)
const PROVIDER_BROADCAST_INTERVAL = 4000;

// ─── One-shot: get current position ──────────────────────────────────────────
// Call this when the motorist taps "Confirm" to get their exact breakdown location.

export async function getCurrentLocation() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied. Please enable location in Settings.');
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy: location.coords.accuracy,
  };
}

// ─── Reverse geocode ──────────────────────────────────────────────────────────
// Converts lat/lng to a human-readable address string.

export async function reverseGeocode(lat, lng) {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!results?.length) return null;
    const r = results[0];
    const parts = [r.street, r.district, r.city].filter(Boolean);
    return parts.join(', ') || r.formattedAddress || null;
  } catch {
    return null;
  }
}

// ─── useCurrentLocation ───────────────────────────────────────────────────────
// Simple hook for screens that just need to show the user's current location once.
// Used on HomeScreen and ConfirmScreen.

export function useCurrentLocation() {
  const [location, setLocation] = useState(null);
  const [address,  setAddress]  = useState('Getting your location...');
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      try {
        const loc = await getCurrentLocation();
        if (cancelled) return;
        setLocation(loc);

        const addr = await reverseGeocode(loc.lat, loc.lng);
        if (!cancelled && addr) setAddress(addr);
        else if (!cancelled) setAddress(`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setAddress('Location unavailable');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    return () => { cancelled = true; };
  }, []);

  return { location, address, error, loading };
}

// ─── useProviderLocationBroadcast ─────────────────────────────────────────────
// Used in the provider app when navigating to a job.
// Continuously gets GPS position and broadcasts it via WebSocket.
// Also requests background location permission for when the screen locks.

export function useProviderLocationBroadcast({ socket, isActive, jobId }) {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [permissionLevel, setPermissionLevel]  = useState(null);  // 'foreground' | 'background' | 'denied'
  const intervalRef = useRef(null);
  const watchRef    = useRef(null);

  const startBroadcasting = useCallback(async () => {
    // Step 1: Foreground permission (required)
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      setPermissionLevel('denied');
      return;
    }

    // Step 2: Background permission (important for when screen locks)
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    setPermissionLevel(bgStatus === 'granted' ? 'background' : 'foreground');

    if (bgStatus !== 'granted') {
      console.warn('[Location] Background permission denied — tracking will pause when screen locks');
    }

    // Step 3: Start watching position
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy:          Location.Accuracy.BestForNavigation,
        timeInterval:      PROVIDER_BROADCAST_INTERVAL,
        distanceInterval:  10,   // only update if moved >10 metres
      },
      (loc) => {
        const coords = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          heading:  loc.coords.heading,
          speed:    loc.coords.speed,
          accuracy: loc.coords.accuracy,
        };
        setCurrentLocation(coords);

        // Broadcast via WebSocket if connected
        if (socket?.connected) {
          socket.emit('update_location', { location: coords });
        }
      }
    );
  }, [socket]);

  const stopBroadcasting = useCallback(() => {
    if (watchRef.current) {
      watchRef.current.remove();
      watchRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      startBroadcasting();
    } else {
      stopBroadcasting();
    }
    return stopBroadcasting;
  }, [isActive]);

  return { currentLocation, permissionLevel };
}

// ─── useMotorístLocationWatch ─────────────────────────────────────────────────
// Used in the motorist tracking screen.
// Keeps the motorist's own location up to date on the map.
// Does NOT broadcast to the server — motorist location is set at job creation time.

export function useMotoristLocationWatch() {
  const [location, setLocation] = useState(null);
  const watchRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 20 },
        (loc) => {
          if (!cancelled) {
            setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          }
        }
      );
    }

    start();
    return () => {
      cancelled = true;
      watchRef.current?.remove();
    };
  }, []);

  return location;
}

// ─── Calculate ETA ────────────────────────────────────────────────────────────
// Uses the backend endpoint which calls Google Maps Distance Matrix API.
// Falls back to straight-line estimate if API is unavailable.

export async function calculateETA(originLat, originLng, destLat, destLng) {
  try {
    const token = await AsyncStorage.getItem('rr_token');
    const res   = await fetch(`${API}/api/maps/eta`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ originLat, originLng, destLat, destLng }),
    });
    if (!res.ok) throw new Error('ETA fetch failed');
    const data = await res.json();
    return { minutes: data.durationMinutes, distanceKm: data.distanceKm, text: data.durationText };
  } catch {
    // Fallback: Haversine straight-line distance ÷ 30km/h average in Nairobi traffic
    const R    = 6371;
    const dLat = (destLat - originLat) * Math.PI / 180;
    const dLng = (destLng - originLng) * Math.PI / 180;
    const a    = Math.sin(dLat/2)**2 + Math.cos(originLat*Math.PI/180)*Math.cos(destLat*Math.PI/180)*Math.sin(dLng/2)**2;
    const km   = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const mins = Math.round((km / 30) * 60);
    return { minutes: mins, distanceKm: parseFloat(km.toFixed(1)), text: `~${mins} min` };
  }
}
