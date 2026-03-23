/**
 * RoadReady — Sentry Mobile Error Tracking
 *
 * Shared between motorist-app and provider-app.
 *
 * Install:
 *   npx expo install @sentry/react-native
 *
 * Then run the Sentry wizard to patch your native files:
 *   npx sentry-wizard@latest -i reactNative
 *
 * Add to .env:
 *   EXPO_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
 */

import * as Sentry from '@sentry/react-native';
import Constants   from 'expo-constants';

let initialised = false;

export function initSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;   // Sentry disabled — fail silently

  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    release:     Constants.expoConfig?.version || '1.0.0',
    dist:        String(Constants.expoConfig?.ios?.buildNumber
                     || Constants.expoConfig?.android?.versionCode
                     || 1),

    // Performance monitoring — sample 10% of sessions
    tracesSampleRate: __DEV__ ? 1.0 : 0.1,

    // Don't report errors in dev mode (they show in the console instead)
    enabled: !__DEV__,

    // Scrub phone numbers and tokens from error reports
    beforeSend(event) {
      if (event.extra) {
        ['phone', 'token', 'password', 'code'].forEach(key => {
          if (event.extra[key]) event.extra[key] = '[REDACTED]';
        });
      }
      return event;
    },
  });

  initialised = true;
}

export function captureException(err, context = {}) {
  if (!initialised) {
    if (__DEV__) console.error('[Sentry would capture]', err, context);
    return;
  }
  Sentry.withScope(scope => {
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.screen) scope.setTag('screen', context.screen);
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(err);
  });
}

export function captureMessage(msg, level = 'info', context = {}) {
  if (!initialised) return;
  Sentry.withScope(scope => {
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureMessage(msg, level);
  });
}

export function setUser(userId, role) {
  if (!initialised) return;
  Sentry.setUser({ id: userId, role });
}

export function clearUser() {
  if (!initialised) return;
  Sentry.setUser(null);
}

// Wrap the root component for automatic crash reporting
export { Sentry };
