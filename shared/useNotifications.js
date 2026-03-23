/**
 * RoadReady — useNotifications hook
 *
 * Handles everything notification-related in one place:
 *   1. Request permission from the user
 *   2. Get the FCM device token
 *   3. Register it on the backend
 *   4. Listen for foreground notifications and show them in-app
 *   5. Handle taps on background/killed notifications (deep link into the right screen)
 *   6. Refresh the token when FCM rotates it
 *
 * Usage (in your root App component):
 *
 *   const { permissionStatus } = useNotifications({
 *     onJobAlert:     (job)   => setIncomingJob(job),
 *     onNavigateTo:   (screen, params) => navigate(screen, params),
 *   });
 *
 * Install:
 *   npx expo install expo-notifications expo-device expo-constants
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Configure how notifications appear when app is in foreground ────────────
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    // Job alerts always show even in foreground — other notifications too
    return {
      shouldShowAlert: true,
      shouldPlaySound: data?.type === 'new_job',   // only play sound for job alerts in foreground
      shouldSetBadge: true,
    };
  },
});

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useNotifications({ onJobAlert, onNavigateTo } = {}) {
  const [permissionStatus, setPermissionStatus] = useState(null);
  const [deviceToken, setDeviceToken]           = useState(null);
  const appState = useRef(AppState.currentState);

  // ── Register for push notifications ──────────────────────────────────────
  const register = useCallback(async () => {
    // Physical device only — simulator can't receive push notifications
    if (!Device.isDevice) {
      console.log('[Notifications] Skipping — not a physical device');
      return null;
    }

    // Check & request permission
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    setPermissionStatus(finalStatus);

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission denied');
      return null;
    }

    // Android: create notification channels
    if (Platform.OS === 'android') {
      await createAndroidChannels();
    }

    // Get the Expo push token (wraps FCM token)
    const projectId = Constants.expoConfig?.extra?.eas?.projectId
                   || Constants.easConfig?.projectId;

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    setDeviceToken(token);
    await saveTokenToBackend(token);
    return token;
  }, []);

  // ── Listen for foreground notifications ──────────────────────────────────
  useEffect(() => {
    register();

    // Foreground notification received
    const foregroundSub = Notifications.addNotificationReceivedListener(notification => {
      const data = notification.request.content.data;
      handleNotificationData(data, 'foreground');
    });

    // User tapped a notification (background or killed state)
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      handleNotificationData(data, 'tap');
    });

    // Token refresh — FCM occasionally rotates tokens
    const tokenSub = Notifications.addPushTokenListener(async ({ data: newToken }) => {
      if (newToken && newToken !== deviceToken) {
        setDeviceToken(newToken);
        await saveTokenToBackend(newToken);
      }
    });

    // Re-register when app comes back to foreground (covers token rotation)
    const appStateSub = AppState.addEventListener('change', async (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        await register();
      }
      appState.current = nextState;
    });

    return () => {
      foregroundSub.remove();
      responseSub.remove();
      tokenSub.remove();
      appStateSub.remove();
    };
  }, []);

  // ── Route incoming notification data to the right handler ────────────────
  function handleNotificationData(data, source) {
    if (!data?.type) return;

    console.log(`[Notifications] ${data.type} (${source})`);

    switch (data.type) {

      // ── Provider: incoming job ──────────────────────────────────────────
      case 'new_job':
        if (onJobAlert) {
          onJobAlert({
            id:              data.jobId,
            serviceId:       data.serviceId,
            serviceName:     data.serviceName,
            serviceEmoji:    data.serviceEmoji,
            address:         data.address,
            lat:             parseFloat(data.lat),
            lng:             parseFloat(data.lng),
            price:           parseInt(data.price),
            providerEarning: parseInt(data.providerEarning),
            distanceKm:      parseFloat(data.distanceKm),
            expiresInSeconds:parseInt(data.expiresInSeconds) || 60,
          });
        }
        break;

      // ── Motorist: provider matched ──────────────────────────────────────
      case 'provider_matched':
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('tracking', { jobId: data.jobId });
        }
        break;

      // ── Motorist: provider arrived ──────────────────────────────────────
      case 'provider_arrived':
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('tracking', { jobId: data.jobId });
        }
        break;

      // ── Motorist: job complete — go to payment ──────────────────────────
      case 'job_complete':
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('payment', { jobId: data.jobId, price: parseInt(data.price) });
        }
        break;

      // ── Motorist: payment confirmed ─────────────────────────────────────
      case 'payment_confirmed':
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('home');
        }
        break;

      // ── Either: job cancelled ───────────────────────────────────────────
      case 'job_cancelled':
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('home');
        }
        break;

      // ── Motorist: no providers yet ──────────────────────────────────────
      case 'no_providers':
        // No navigation needed — just awareness
        break;

      default:
        if (source === 'tap' && onNavigateTo) {
          onNavigateTo('home');
        }
    }
  }

  return { permissionStatus, deviceToken };
}

// ─── Save FCM token to backend ────────────────────────────────────────────────

async function saveTokenToBackend(token) {
  try {
    const authToken = await AsyncStorage.getItem('rr_token');
    if (!authToken) return;   // not logged in yet — will register after login

    // /api/auth/device-token works for ALL roles (motorist, provider, admin).
    // The old /api/providers/device-token endpoint returned 403 for motorists,
    // which silently prevented motorists from receiving push notifications.
    const response = await fetch(`${API}/api/auth/device-token`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body:    JSON.stringify({ deviceToken: token }),
    });

    if (response.ok) {
      await AsyncStorage.setItem('rr_device_token', token);
      console.log('[Notifications] Token registered on backend');
    } else {
      console.warn('[Notifications] Backend rejected token registration — status', response.status);
    }
  } catch (err) {
    console.error('[Notifications] Failed to save token:', err.message);
  }
}

// ─── Android notification channels ───────────────────────────────────────────
// Must match the channelId values in backend/notifications/templates.js

async function createAndroidChannels() {
  await Notifications.setNotificationChannelAsync('job_alerts', {
    name:               'Job Alerts',
    importance:          Notifications.AndroidImportance.MAX,
    vibrationPattern:   [0, 250, 250, 250],
    lightColor:         '#E8631A',
    sound:              'job_alert.wav',    // file in assets/sounds/
    enableVibrate:       true,
    showBadge:           true,
    description:        'New job available alerts — urgent',
  });

  await Notifications.setNotificationChannelAsync('job_updates', {
    name:        'Job Updates',
    importance:   Notifications.AndroidImportance.HIGH,
    sound:       'default',
    description: 'Status updates for your active job',
  });

  await Notifications.setNotificationChannelAsync('payments', {
    name:        'Payments',
    importance:   Notifications.AndroidImportance.DEFAULT,
    sound:       'default',
    description: 'Payment confirmations and payout alerts',
  });

  await Notifications.setNotificationChannelAsync('general', {
    name:        'General',
    importance:   Notifications.AndroidImportance.LOW,
    description: 'General app notifications',
  });
}

// ─── Utility: call this after login to ensure token is registered ─────────────

export async function registerTokenAfterLogin() {
  const savedToken = await AsyncStorage.getItem('rr_device_token');
  if (savedToken) {
    await saveTokenToBackend(savedToken);
  }
}

// ─── Utility: clear badge count (call when user opens the app) ───────────────

export async function clearBadge() {
  await Notifications.setBadgeCountAsync(0);
}

// ─── Utility: schedule a local notification (e.g. 60s job expiry warning) ────

export async function scheduleLocalNotification(title, body, seconds) {
  return Notifications.scheduleNotificationAsync({
    content: { title, body, sound: 'default' },
    trigger: { seconds },
  });
}

export async function cancelLocalNotification(notificationId) {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
