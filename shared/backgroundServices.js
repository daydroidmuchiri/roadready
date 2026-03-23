/**
 * RoadReady — Background Location + Offline Queue
 *
 * Two things in one file:
 *
 * 1. BACKGROUND LOCATION TASK
 *    Uses Expo TaskManager to track provider GPS even when the
 *    app is backgrounded or the screen is locked.
 *    Registered in app.json under "plugins" section.
 *
 * 2. OFFLINE QUEUE
 *    Stores failed API calls in AsyncStorage.
 *    Replays them when connectivity is restored.
 *    Used for: location updates, job status changes, rating submissions.
 *
 * Install:
 *   npx expo install expo-task-manager expo-location @react-native-community/netinfo
 *
 * app.json must include (already in our app.json):
 *   "plugins": [["expo-location", { "isAndroidBackgroundLocationEnabled": true }]]
 *   android.permissions includes "android.permission.ACCESS_BACKGROUND_LOCATION"
 */

import * as TaskManager    from 'expo-task-manager';
import * as Location       from 'expo-location';
import NetInfo             from '@react-native-community/netinfo';
import AsyncStorage        from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const BACKGROUND_LOCATION_TASK = 'rr-background-location';
const OFFLINE_QUEUE_KEY        = 'rr_offline_queue';
const MAX_QUEUE_SIZE           = 50;

// ─── BACKGROUND LOCATION TASK ─────────────────────────────────────────────────
//
// This runs in a background OS process. It has restrictions:
//   - Cannot import React or use hooks
//   - Cannot access component state
//   - Must store data in AsyncStorage then sync later
//
// The task fires every ~10s (Android) or ~5s (iOS) with a new GPS reading.

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BGLocation] Error:', error.message);
    return;
  }

  const { locations } = data;
  const latest = locations?.[0];
  if (!latest) return;

  const coords = {
    lat:      latest.coords.latitude,
    lng:      latest.coords.longitude,
    heading:  latest.coords.heading,
    speed:    latest.coords.speed,
    accuracy: latest.coords.accuracy,
  };

  // Try to send immediately
  try {
    const token = await AsyncStorage.getItem('rr_token');
    if (!token) return;

    const res = await fetch(`${API}/api/providers/location`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ location: coords }),
      signal:  AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Also update via WebSocket (if socket is connected in foreground, this will be a duplicate — that's fine)
    // The server deduplicates location updates

  } catch {
    // Network failed — queue the update for retry
    await enqueueOfflineAction({
      type:      'location_update',
      payload:   { location: coords },
      endpoint:  '/api/providers/location',
      method:    'PATCH',
      timestamp: Date.now(),
    });
  }
});

// ─── Start background location ────────────────────────────────────────────────

export async function startBackgroundLocation() {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') {
    console.warn('[BGLocation] Foreground permission denied');
    return false;
  }

  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') {
    console.warn('[BGLocation] Background permission denied — tracking pauses when screen locks');
    // Still allow foreground tracking — better than nothing
  }

  const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRunning) return true;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy:              Location.Accuracy.BestForNavigation,
    timeInterval:          10000,    // update every 10 seconds
    distanceInterval:      15,       // or every 15 metres (whichever comes first)
    foregroundService: {
      notificationTitle:   'RoadReady — Navigating to Job',
      notificationBody:    'Your location is being shared with the motorist',
      notificationColor:   '#E8631A',
    },
    // iOS: allow background updates
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically:       false,
  });

  console.log('[BGLocation] Background tracking started');
  return true;
}

export async function stopBackgroundLocation() {
  const isRunning = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    console.log('[BGLocation] Background tracking stopped');
  }
}

export async function isBackgroundLocationRunning() {
  return TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
}

// ─── OFFLINE QUEUE ────────────────────────────────────────────────────────────

async function getQueue() {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveQueue(queue) {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
}

export async function enqueueOfflineAction(action) {
  const queue = await getQueue();
  queue.push({ ...action, id: `${Date.now()}_${Math.random().toString(36).slice(2)}` });
  await saveQueue(queue);
}

export async function flushOfflineQueue() {
  const queue = await getQueue();
  if (!queue.length) return;

  const net = await NetInfo.fetch();
  if (!net.isConnected) return;

  const token   = await AsyncStorage.getItem('rr_token');
  if (!token) return;

  const failed  = [];
  let processed = 0;

  for (const action of queue) {
    try {
      const res = await fetch(`${API}${action.endpoint}`, {
        method:  action.method || 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify(action.payload),
        signal:  AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        // 4xx = permanent failure, don't retry
        if (res.status >= 400 && res.status < 500) continue;
        // 5xx = server error, retry later
        failed.push(action);
      } else {
        processed++;
      }
    } catch {
      // Network error — retry later
      // Drop items older than 24 hours
      if (Date.now() - action.timestamp < 86400000) failed.push(action);
    }
  }

  await saveQueue(failed);

  if (processed > 0) {
    console.log(`[OfflineQueue] Flushed ${processed} queued actions, ${failed.length} remaining`);
  }
}

// ─── Network monitor — flush queue when connectivity restored ─────────────────

export function startOfflineQueueMonitor() {
  let wasOffline = false;

  const unsubscribe = NetInfo.addEventListener(state => {
    if (!state.isConnected) {
      wasOffline = true;
    } else if (wasOffline && state.isConnected) {
      wasOffline = false;
      // Back online — flush the queue
      flushOfflineQueue().catch(() => {});
    }
  });

  // Also flush on startup
  flushOfflineQueue().catch(() => {});

  // And every 5 minutes (catches cases where queue builds up while online)
  const interval = setInterval(() => flushOfflineQueue().catch(() => {}), 5 * 60 * 1000);

  return () => {
    unsubscribe();
    clearInterval(interval);
  };
}

// ─── Hook: use in provider App root ───────────────────────────────────────────
// Starts background location when provider is on a job,
// stops it when they're not. Manages the queue monitor.

import { useEffect } from 'react';

export function useProviderBackgroundServices({ isNavigatingToJob }) {
  useEffect(() => {
    const stopQueueMonitor = startOfflineQueueMonitor();
    return stopQueueMonitor;
  }, []);

  useEffect(() => {
    if (isNavigatingToJob) {
      startBackgroundLocation().catch(() => {});
    } else {
      stopBackgroundLocation().catch(() => {});
    }
  }, [isNavigatingToJob]);
}
