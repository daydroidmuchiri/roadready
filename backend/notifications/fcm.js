/**
 * RoadReady — FCM Notification Service
 *
 * Uses firebase-admin to send push notifications via FCM.
 * Handles single sends, multicast, topic sends, and failed token cleanup.
 *
 * Setup:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" → download JSON
 *   3. Set FIREBASE_SERVICE_ACCOUNT_JSON env var to the file contents (as a string)
 *      OR set FIREBASE_SERVICE_ACCOUNT_PATH to the file path
 */

const admin = require('firebase-admin');
const { Users } = require('../db/queries');

// ─── Initialise Firebase Admin ────────────────────────────────────────────────

let firebaseApp = null;

function getFirebaseApp() {
  if (firebaseApp) return firebaseApp;

  try {
    let credential;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      // Env var contains the JSON string directly (preferred for production)
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = admin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      // Env var points to a file path (useful for local dev)
      credential = admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH));
    } else {
      console.warn('[FCM] No Firebase credentials found — push notifications disabled.');
      return null;
    }

    firebaseApp = admin.initializeApp({ credential });
    console.log(JSON.stringify({ level: 'INFO', event: 'fcm_initialised' }));
    return firebaseApp;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR', event: 'fcm_init_failed', message: err.message,
    }));
    return null;
  }
}

// ─── Send to a single device token ───────────────────────────────────────────

async function sendToToken(deviceToken, notification, data = {}) {
  const app = getFirebaseApp();
  if (!app) return { success: false, reason: 'fcm_disabled' };

  const message = {
    token: deviceToken,
    notification: {
      title: notification.title,
      body:  notification.body,
    },
    data: sanitiseData(data),
    android: {
      priority: 'high',
      notification: {
        channelId: notification.channelId || 'default',
        sound:     notification.sound     || 'default',
        priority:  'max',
        // Show notification even when app is in foreground on Android
        visibility: 'public',
      },
    },
    apns: {
      payload: {
        aps: {
          sound:            notification.sound || 'default',
          badge:            notification.badge || 1,
          contentAvailable: true,
          // Critical alert for job alerts (bypasses Do Not Disturb)
          ...(notification.critical ? { interruptionLevel: 'time-sensitive' } : {}),
        },
      },
    },
  };

  try {
    const response = await admin.messaging(app).send(message);
    return { success: true, messageId: response };
  } catch (err) {
    // Token is invalid or unregistered — remove it from DB
    if (isStaleTokenError(err)) {
      await Users.updateDeviceToken(null, deviceToken).catch(() => {});
      return { success: false, reason: 'stale_token' };
    }
    console.error(JSON.stringify({
      level: 'ERROR', event: 'fcm_send_failed',
      message: err.message, code: err.code,
    }));
    return { success: false, reason: err.code };
  }
}

// ─── Send to a user (looks up their device token) ────────────────────────────

async function sendToUser(userId, notification, data = {}) {
  const user = await Users.findById(userId);
  if (!user?.deviceToken) {
    console.log(JSON.stringify({
      level: 'INFO', event: 'fcm_no_token', userId,
      message: 'User has no device token — skipping push',
    }));
    return { success: false, reason: 'no_token' };
  }
  return sendToToken(user.deviceToken, notification, data);
}

// ─── Send to multiple users ───────────────────────────────────────────────────

async function sendToUsers(userIds, notification, data = {}) {
  const results = await Promise.allSettled(
    userIds.map(id => sendToUser(id, notification, data))
  );
  const succeeded = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
  const failed    = results.length - succeeded;
  return { succeeded, failed, total: results.length };
}

// ─── Send to a topic ──────────────────────────────────────────────────────────
// Use for broadcasts: e.g. 'providers-nairobi', 'all-motorists'

async function sendToTopic(topic, notification, data = {}) {
  const app = getFirebaseApp();
  if (!app) return { success: false, reason: 'fcm_disabled' };

  try {
    const response = await admin.messaging(app).send({
      topic,
      notification: { title: notification.title, body: notification.body },
      data: sanitiseData(data),
      android: { priority: 'high' },
    });
    return { success: true, messageId: response };
  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'fcm_topic_failed', message: err.message }));
    return { success: false, reason: err.code };
  }
}

// ─── Subscribe / Unsubscribe tokens from topics ───────────────────────────────

async function subscribeToTopic(deviceTokens, topic) {
  const app = getFirebaseApp();
  if (!app) return;
  const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
  try {
    await admin.messaging(app).subscribeToTopic(tokens, topic);
  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'fcm_subscribe_failed', message: err.message }));
  }
}

async function unsubscribeFromTopic(deviceTokens, topic) {
  const app = getFirebaseApp();
  if (!app) return;
  const tokens = Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens];
  try {
    await admin.messaging(app).unsubscribeFromTopic(tokens, topic);
  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'fcm_unsubscribe_failed', message: err.message }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// FCM data payload values must all be strings
function sanitiseData(data) {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
  );
}

function isStaleTokenError(err) {
  return ['messaging/registration-token-not-registered',
          'messaging/invalid-registration-token',
          'messaging/invalid-argument'].includes(err.code);
}

module.exports = {
  sendToToken,
  sendToUser,
  sendToUsers,
  sendToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
};
