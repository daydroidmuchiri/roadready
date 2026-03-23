/**
 * RoadReady — Notification Templates & Senders
 *
 * One function per notification event.
 * server.js calls these — it never builds notification payloads directly.
 *
 * Every function:
 *  1. Builds the notification payload
 *  2. Sends via FCM (push — works when app is closed/backgrounded)
 *  3. Returns the FCM result so callers can log it
 *
 * Socket.IO handles the real-time update when the app IS open.
 * FCM handles it when the app is NOT open.
 * Both fire for every event — they don't interfere.
 */

const { sendToUser, sendToUsers } = require('./fcm');

// ─── Android notification channels ───────────────────────────────────────────
// These must match the channels registered in the mobile apps.

const CHANNELS = {
  JOB_ALERT:  'job_alerts',    // high priority, sound + vibration
  JOB_UPDATE: 'job_updates',   // medium priority
  PAYMENT:    'payments',      // medium priority
  GENERAL:    'general',       // low priority
};

// ─── Provider Notifications ───────────────────────────────────────────────────

/**
 * New job available — sent to the best matched provider.
 * This is the most critical notification in the whole app.
 * Provider has 60 seconds to accept before it goes to the next person.
 */
async function notifyProviderNewJob(providerId, job, distanceKm) {
  const distText  = distanceKm < 1
    ? `${Math.round(distanceKm * 1000)}m away`
    : `${distanceKm.toFixed(1)}km away`;

  return sendToUser(providerId, {
    title:     '🔔 New Job Available!',
    body:      `${job.serviceEmoji || '🔧'} ${job.serviceName} · ${distText} · KES ${job.providerEarning?.toLocaleString() || job.price}`,
    channelId: CHANNELS.JOB_ALERT,
    sound:     'job_alert.wav',   // custom sound file in the mobile app
    critical:  true,              // time-sensitive — bypasses silent mode
    badge:     1,
  }, {
    type:            'new_job',
    jobId:           job.id,
    serviceId:       job.serviceId,
    serviceName:     job.serviceName || '',
    serviceEmoji:    job.serviceEmoji || '',
    address:         job.address,
    lat:             String(job.lat),
    lng:             String(job.lng),
    price:           String(job.price),
    providerEarning: String(job.providerEarning || job.price - job.commission),
    distanceKm:      String(distanceKm.toFixed(2)),
    expiresInSeconds:'60',
  });
}

/**
 * Job was cancelled by the motorist while provider was en route or on site.
 * Provider needs to know immediately so they don't keep driving.
 */
async function notifyProviderJobCancelled(providerId, job) {
  return sendToUser(providerId, {
    title:     '❌ Job Cancelled',
    body:      `The motorist cancelled their ${job.serviceName || 'request'}. You are now available for new jobs.`,
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     0,
  }, {
    type:  'job_cancelled',
    jobId: job.id,
  });
}

/**
 * Payout processed — provider's M-Pesa payment has been sent.
 */
async function notifyProviderPayoutSent(providerId, amount, mpesaReceipt) {
  return sendToUser(providerId, {
    title:     '💰 Payout Sent!',
    body:      `KES ${amount.toLocaleString()} has been sent to your M-Pesa. Ref: ${mpesaReceipt}`,
    channelId: CHANNELS.PAYMENT,
    sound:     'default',
  }, {
    type:         'payout_sent',
    amount:       String(amount),
    mpesaReceipt: mpesaReceipt || '',
  });
}

/**
 * Onboarding status changed — provider approved or rejected.
 */
async function notifyProviderOnboardingUpdate(providerId, status) {
  const approved = status === 'approved';
  return sendToUser(providerId, {
    title: approved ? '✅ You\'re approved!' : '⚠️ Application Update',
    body:  approved
      ? 'Your RoadReady provider account is approved. You can now go online and start earning!'
      : 'Your application needs attention. Open the app to see what\'s required.',
    channelId: CHANNELS.GENERAL,
    sound:     'default',
  }, {
    type:            'onboarding_update',
    onboardStatus:   status,
  });
}

// ─── Motorist Notifications ───────────────────────────────────────────────────

/**
 * A provider has been matched and is on their way.
 * Most important notification for the motorist — reassurance that help is coming.
 */
async function notifyMotoristProviderMatched(motoristId, job, provider, etaMinutes) {
  return sendToUser(motoristId, {
    title:     '🔧 Help is on the way!',
    body:      `${provider.name} is heading to you · ETA ${etaMinutes} min · ⭐${Number(provider.rating).toFixed(1)}`,
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     1,
  }, {
    type:          'provider_matched',
    jobId:         job.id,
    providerId:    provider.id,
    providerName:  provider.name,
    providerRating:String(provider.rating),
    etaMinutes:    String(etaMinutes),
  });
}

/**
 * Provider has arrived at the motorist's location.
 */
async function notifyMotoristProviderArrived(motoristId, job, providerName) {
  return sendToUser(motoristId, {
    title:     '📍 Your mechanic has arrived!',
    body:      `${providerName} is at your location. Please look out for them.`,
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     1,
  }, {
    type:         'provider_arrived',
    jobId:        job.id,
    providerName: providerName,
  });
}

/**
 * Job is complete — prompt motorist to rate and pay.
 */
async function notifyMotoristJobComplete(motoristId, job, providerName) {
  return sendToUser(motoristId, {
    title:     '✅ Job complete!',
    body:      `${providerName} has finished. Please rate your experience and complete payment of KES ${job.price?.toLocaleString()}.`,
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     1,
  }, {
    type:         'job_complete',
    jobId:        job.id,
    price:        String(job.price),
    providerName: providerName,
  });
}

/**
 * Payment confirmed via M-Pesa.
 */
async function notifyMotoristPaymentConfirmed(motoristId, job, mpesaReceipt) {
  return sendToUser(motoristId, {
    title:     '💳 Payment confirmed!',
    body:      `KES ${job.price?.toLocaleString()} received. Ref: ${mpesaReceipt}. Thanks for using RoadReady!`,
    channelId: CHANNELS.PAYMENT,
    sound:     'default',
    badge:     0,
  }, {
    type:         'payment_confirmed',
    jobId:        job.id,
    mpesaReceipt: mpesaReceipt || '',
  });
}

/**
 * No providers available after initial search.
 * Reassure the motorist and tell them we're still looking.
 */
async function notifyMotoristNoProviders(motoristId, jobId) {
  return sendToUser(motoristId, {
    title:     '🔍 Still searching...',
    body:      'No providers are nearby right now, but we\'re expanding our search. Please stay safe.',
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     1,
  }, {
    type:  'no_providers',
    jobId: jobId,
  });
}

/**
 * Motorist's job was cancelled (e.g. by admin, or provider couldn't make it).
 */
async function notifyMotoristJobCancelled(motoristId, job, reason) {
  return sendToUser(motoristId, {
    title:     '❌ Job cancelled',
    body:      reason || 'Your job request was cancelled. Please try again.',
    channelId: CHANNELS.JOB_UPDATE,
    sound:     'default',
    badge:     0,
  }, {
    type:   'job_cancelled',
    jobId:  job.id,
    reason: reason || '',
  });
}

// ─── Admin / System Notifications ────────────────────────────────────────────

/**
 * Alert admins when a job has been searching for >10 minutes with no match.
 * Send to all admin users.
 */
async function notifyAdminsJobStuck(adminUserIds, job) {
  return sendToUsers(adminUserIds, {
    title:     '⚠️ Job stuck',
    body:      `Job ${job.id} (${job.serviceName}) has been searching for >10 min with no provider match.`,
    channelId: CHANNELS.JOB_ALERT,
    sound:     'default',
  }, {
    type:  'job_stuck',
    jobId: job.id,
  });
}

module.exports = {
  // Provider
  notifyProviderNewJob,
  notifyProviderJobCancelled,
  notifyProviderPayoutSent,
  notifyProviderOnboardingUpdate,

  // Motorist
  notifyMotoristProviderMatched,
  notifyMotoristProviderArrived,
  notifyMotoristJobComplete,
  notifyMotoristPaymentConfirmed,
  notifyMotoristNoProviders,
  notifyMotoristJobCancelled,

  // Admin
  notifyAdminsJobStuck,
};
