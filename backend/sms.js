/**
 * RoadReady — SMS Service (Africa's Talking)
 *
 * Africa's Talking is the dominant SMS provider in Kenya:
 *   - Lower cost than Twilio (KES ~0.80/SMS vs ~KES 2.50)
 *   - Local Nairobi support team
 *   - M-Pesa API also available through them
 *   - Sandbox for development (no real SMS sent)
 *
 * Setup:
 *   1. Register at africastalking.com
 *   2. Create an app and note the API key
 *   3. In sandbox: username = 'sandbox', key = any string
 *   4. In production: use your real username + API key
 *
 * Env vars needed:
 *   AT_USERNAME   — your Africa's Talking username
 *   AT_API_KEY    — your Africa's Talking API key
 *   AT_SENDER_ID  — your registered sender ID e.g. 'RoadReady' (optional)
 *
 * Install: npm install africastalking
 */

const AfricasTalking = require('africastalking');

let client = null;

function getClient() {
  if (client) return client;

  const username = process.env.AT_USERNAME;
  const apiKey   = process.env.AT_API_KEY;

  if (!username || !apiKey) {
    console.warn('[SMS] Africa\'s Talking credentials not configured — SMS disabled');
    return null;
  }

  client = AfricasTalking({ username, apiKey });
  return client;
}

// ─── Normalise Kenyan phone number ────────────────────────────────────────────
// Africa's Talking requires E.164 format: +2547XXXXXXXX

function normalisePhone(phone) {
  const digits = phone.replace(/\D/g, '');

  // Already has country code
  if (digits.startsWith('254') && digits.length === 12) return '+' + digits;
  if (digits.startsWith('2547') || digits.startsWith('2541')) return '+' + digits;

  // Kenyan 07XX or 01XX format
  if (digits.startsWith('07') && digits.length === 10) return '+254' + digits.slice(1);
  if (digits.startsWith('01') && digits.length === 10) return '+254' + digits.slice(1);

  // Already has +254
  if (phone.startsWith('+254')) return phone;

  throw new Error(`Cannot normalise phone number: ${phone}`);
}

// ─── Send OTP SMS ─────────────────────────────────────────────────────────────

async function sendOTP(phone, code) {
  const at = getClient();
  const normalisedPhone = normalisePhone(phone);

  const message = `Your RoadReady code is: ${code}\n\nValid for 10 minutes. Do not share this code with anyone.`;

  // Development / test mode — log instead of sending
  if (process.env.NODE_ENV !== 'production' || process.env.SMS_DRY_RUN === 'true') {
    console.log(JSON.stringify({
      level: 'INFO', event: 'sms_dry_run',
      phone: normalisedPhone, code,
      message: 'SMS not sent in dev mode — code logged here',
    }));
    return { success: true, dryRun: true, code };
  }

  if (!at) {
    console.warn('[SMS] No SMS client — OTP not sent');
    return { success: false, reason: 'no_client' };
  }

  try {
    const sms = at.SMS;
    const result = await sms.send({
      to:      [normalisedPhone],
      message,
      from:    process.env.AT_SENDER_ID || undefined,
    });

    const recipient = result.SMSMessageData?.Recipients?.[0];

    if (recipient?.status === 'Success' || recipient?.statusCode === 101) {
      console.log(JSON.stringify({
        level: 'INFO', event: 'sms_sent',
        phone: normalisedPhone,
        messageId: recipient?.messageId,
        cost: recipient?.cost,
      }));
      return { success: true, messageId: recipient?.messageId };
    }

    console.error(JSON.stringify({
      level: 'ERROR', event: 'sms_failed',
      phone: normalisedPhone,
      status: recipient?.status,
      statusCode: recipient?.statusCode,
    }));
    return { success: false, reason: recipient?.status || 'unknown' };

  } catch (err) {
    console.error(JSON.stringify({
      level: 'ERROR', event: 'sms_error',
      phone: normalisedPhone,
      message: err.message,
    }));
    return { success: false, reason: err.message };
  }
}

// ─── Send generic SMS ─────────────────────────────────────────────────────────
// For non-OTP messages: job alerts, payment receipts, etc.

async function sendSMS(phone, message) {
  const at = getClient();
  if (!at) return { success: false, reason: 'no_client' };

  const normalisedPhone = normalisePhone(phone);

  if (process.env.NODE_ENV !== 'production') {
    console.log(JSON.stringify({ level: 'INFO', event: 'sms_dry_run', phone: normalisedPhone, message }));
    return { success: true, dryRun: true };
  }

  try {
    const result = await at.SMS.send({
      to: [normalisedPhone],
      message,
      from: process.env.AT_SENDER_ID || undefined,
    });
    const recipient = result.SMSMessageData?.Recipients?.[0];
    return { success: recipient?.status === 'Success', messageId: recipient?.messageId };
  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'sms_send_error', message: err.message }));
    return { success: false, reason: err.message };
  }
}

module.exports = { sendOTP, sendSMS, normalisePhone };
