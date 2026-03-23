/**
 * RoadReady Mobile — Shared Error Handling Utilities
 * Used by both motorist-app and provider-app
 *
 * Copy this file into: src/utils/errorHandling.js
 */

import { Alert, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

// ─── API Client with full error handling ─────────────────────────────────────

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const REQUEST_TIMEOUT_MS = 15000;   // 15 seconds

/**
 * Wraps fetch with: timeout, network check, error parsing, and retry logic.
 */
async function apiFetch(path, options = {}, retries = 1) {
  // Check network connectivity first
  const netState = await NetInfo.fetch();
  if (!netState.isConnected) {
    throw new AppError('NO_NETWORK', 'No internet connection. Please check your network and try again.');
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // Parse response body
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      // Server returned an error response
      const message = body?.error?.message || body?.error || `Server error (${response.status})`;
      const code    = body?.error?.code    || `HTTP_${response.status}`;
      const fields  = body?.error?.fields  || null;
      throw new AppError(code, message, response.status, fields);
    }

    return body;

  } catch (err) {
    clearTimeout(timeoutId);

    // Already an AppError — rethrow
    if (err instanceof AppError) {
      // Retry on network errors (not on 4xx/5xx responses)
      if (err.code === 'NO_NETWORK' || err.statusCode >= 500) {
        if (retries > 0) {
          await sleep(1000);
          return apiFetch(path, options, retries - 1);
        }
      }
      throw err;
    }

    // AbortError = timeout
    if (err.name === 'AbortError') {
      throw new AppError('TIMEOUT', 'Request timed out. Please check your connection and try again.');
    }

    // Network error (fetch itself failed — no connection, DNS failure, etc.)
    if (err.message === 'Network request failed') {
      if (retries > 0) {
        await sleep(1000);
        return apiFetch(path, options, retries - 1);
      }
      throw new AppError('NETWORK_ERROR', 'Could not reach the server. Please try again.');
    }

    throw new AppError('UNKNOWN', err.message || 'An unexpected error occurred.');
  }
}

// ─── Authenticated API helpers ────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage';

async function getAuthHeaders() {
  const token = await AsyncStorage.getItem('rr_token');
  if (!token) throw new AppError('AUTH_ERROR', 'You are not logged in. Please log in again.', 401);
  return { Authorization: `Bearer ${token}` };
}

export const api = {
  async get(path) {
    const headers = await getAuthHeaders();
    return apiFetch(path, { method: 'GET', headers });
  },
  async post(path, body) {
    const headers = await getAuthHeaders();
    return apiFetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  },
  async patch(path, body) {
    const headers = await getAuthHeaders();
    return apiFetch(path, { method: 'PATCH', headers, body: JSON.stringify(body) });
  },
  // Public (no auth token needed)
  async postPublic(path, body) {
    return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  },
};

// ─── AppError class ───────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(code, message, statusCode, fields) {
    super(message);
    this.code       = code;
    this.statusCode = statusCode || 0;
    this.fields     = fields || null;
    this.name       = 'AppError';
  }
}

// ─── User-friendly error messages ────────────────────────────────────────────

const ERROR_MESSAGES = {
  NO_NETWORK:    'No internet connection.',
  TIMEOUT:       'Request timed out.',
  NETWORK_ERROR: 'Could not reach the server.',
  AUTH_ERROR:    'Session expired. Please log in again.',
  RATE_LIMITED:  'Too many requests. Please wait a moment.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  NOT_FOUND:     'This item could not be found.',
  CONFLICT:      null,  // Use server message directly — it's specific
  FORBIDDEN:     'You do not have permission to do this.',
  INTERNAL_ERROR:'Something went wrong on our end. Please try again.',
  UNKNOWN:       'An unexpected error occurred.',
};

/**
 * Gets a clean, user-friendly message from any error.
 * Falls back gracefully through multiple layers.
 */
export function getErrorMessage(err) {
  if (!err) return 'An unexpected error occurred.';

  if (err instanceof AppError) {
    // Use predefined message if available, or the server's message
    return ERROR_MESSAGES[err.code] ?? err.message ?? 'An unexpected error occurred.';
  }

  // Plain JS error
  if (err.message) return err.message;

  return 'An unexpected error occurred.';
}

// ─── Alert helpers ────────────────────────────────────────────────────────────

/**
 * Show a standard error alert — call this in catch blocks.
 *
 * Usage:
 *   try { ... } catch (err) { showErrorAlert(err); }
 */
export function showErrorAlert(err, title = 'Something went wrong') {
  const message = getErrorMessage(err);
  Alert.alert(title, message, [{ text: 'OK' }]);
}

/**
 * Show an error alert with a retry option.
 */
export function showRetryAlert(err, onRetry, title = 'Connection Error') {
  const message = getErrorMessage(err);
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Retry', onPress: onRetry },
  ]);
}

// ─── React hooks ─────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from 'react';

/**
 * Wraps an async function with loading, error, and retry state.
 *
 * Usage:
 *   const { execute, loading, error } = useAsync(async () => {
 *     const data = await api.get('/api/jobs');
 *     setJobs(data);
 *   });
 *
 *   useEffect(() => { execute(); }, []);
 *
 *   if (loading) return <LoadingSpinner />;
 *   if (error)   return <ErrorState error={error} onRetry={execute} />;
 */
export function useAsync(asyncFn) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      await asyncFn(...args);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [asyncFn]);

  return { execute, loading, error };
}

/**
 * Monitors network connectivity and returns current state.
 * Shows an offline banner when disconnected.
 *
 * Usage:
 *   const { isConnected, isInternetReachable } = useNetworkStatus();
 */
export function useNetworkStatus() {
  const [netState, setNetState] = useState({ isConnected: true, isInternetReachable: true });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setNetState({
        isConnected:          state.isConnected,
        isInternetReachable:  state.isInternetReachable,
        type:                 state.type,
      });
    });
    return unsubscribe;
  }, []);

  return netState;
}

// ─── Socket connection manager with reconnection ──────────────────────────────

import { io } from 'socket.io-client';

export function createSocket(onConnectionChange) {
  let socket = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_DELAY = 30000;

  async function connect() {
    const token = await AsyncStorage.getItem('rr_token');
    if (!token) {
      onConnectionChange?.('no_auth');
      return null;
    }

    socket = io(API_URL, {
      auth:             { token },
      reconnection:     true,
      reconnectionDelay:       1000,
      reconnectionDelayMax:    MAX_RECONNECT_DELAY,
      reconnectionAttempts:    Infinity,
      timeout:          10000,
    });

    socket.on('connect', () => {
      reconnectAttempts = 0;
      onConnectionChange?.('connected');
      console.log('[Socket] Connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      onConnectionChange?.('disconnected');
      console.warn('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      reconnectAttempts++;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
      onConnectionChange?.('error');
      console.error('[Socket] Connection error:', err.message, '— retrying in', delay + 'ms');
    });

    socket.on('reconnect', (attempt) => {
      onConnectionChange?.('connected');
      console.log('[Socket] Reconnected after', attempt, 'attempt(s)');
    });

    return socket;
  }

  function disconnect() {
    if (socket) { socket.disconnect(); socket = null; }
  }

  function getSocket() { return socket; }

  return { connect, disconnect, getSocket };
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── React Native Error Boundary ─────────────────────────────────────────────

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // In production, send to error tracking service (Sentry, Bugsnag, etc.)
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={eb.container}>
        <Text style={eb.icon}>⚠️</Text>
        <Text style={eb.title}>Something went wrong</Text>
        <Text style={eb.message}>
          {this.props.fallbackMessage || "The app hit an unexpected error. We've been notified and are looking into it."}
        </Text>
        <TouchableOpacity style={eb.btn} onPress={() => this.reset()}>
          <Text style={eb.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const eb = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#060F1C' },
  icon:      { fontSize: 48, marginBottom: 16 },
  title:     { fontSize: 18, fontWeight: '600', color: '#ECF0F7', marginBottom: 8, textAlign: 'center' },
  message:   { fontSize: 14, color: '#7A8AA0', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  btn:       { backgroundColor: '#E8631A', borderRadius: 11, paddingVertical: 13, paddingHorizontal: 28 },
  btnText:   { color: 'white', fontSize: 15, fontWeight: '600' },
});

// ─── Offline Banner Component ─────────────────────────────────────────────────

import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';

export function OfflineBanner() {
  const { isConnected } = useNetworkStatus();
  const translateY      = useSharedValue(isConnected ? -50 : 0);

  useEffect(() => {
    translateY.value = withTiming(isConnected ? -50 : 0, { duration: 300 });
  }, [isConnected]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[ob.banner, animStyle]}>
      <Text style={ob.text}>No internet connection</Text>
    </Animated.View>
  );
}

const ob = StyleSheet.create({
  banner: {
    position:        'absolute', top: 0, left: 0, right: 0, zIndex: 999,
    backgroundColor: '#E03A3A', paddingVertical: 8, paddingHorizontal: 16,
    alignItems:      'center',
  },
  text: { color: 'white', fontSize: 13, fontWeight: '500' },
});

// ─── Input field error display ────────────────────────────────────────────────

export function FieldError({ error }) {
  if (!error) return null;
  return (
    <Text style={{ color: '#E03A3A', fontSize: 12, marginTop: 4, marginLeft: 2 }}>
      {error}
    </Text>
  );
}

/**
 * Extracts field-level errors from an AppError returned by the API.
 * Use this to show inline validation errors under each form field.
 *
 * Usage:
 *   } catch (err) {
 *     setFieldErrors(extractFieldErrors(err));
 *   }
 *
 *   <TextInput ... />
 *   <FieldError error={fieldErrors.phone} />
 */
export function extractFieldErrors(err) {
  if (err instanceof AppError && err.fields) return err.fields;
  return {};
}
