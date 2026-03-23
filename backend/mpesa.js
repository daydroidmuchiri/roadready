/**
 * RoadReady — M-Pesa Daraja API Integration
 *
 * Implements the full Safaricom Daraja STK Push flow:
 *   1. Get OAuth2 access token
 *   2. Initiate STK Push (sends prompt to customer's phone)
 *   3. Handle callback (Safaricom POSTs result to our server)
 *
 * Environment variables required:
 *   MPESA_CONSUMER_KEY      — from Daraja portal
 *   MPESA_CONSUMER_SECRET   — from Daraja portal
 *   MPESA_SHORTCODE         — your till/paybill number (sandbox: 174379)
 *   MPESA_PASSKEY           — from Daraja portal (sandbox passkey available)
 *   MPESA_CALLBACK_URL      — public HTTPS URL (use ngrok for local dev)
 *   MPESA_ENV               — 'sandbox' or 'production'
 */

const MPESA_BASE = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

const CONSUMER_KEY    = process.env.MPESA_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET;
const SHORTCODE       = process.env.MPESA_SHORTCODE    || '174379';
const PASSKEY         = process.env.MPESA_PASSKEY;
const CALLBACK_URL    = process.env.MPESA_CALLBACK_URL;

// ─── OAuth token (cached, refreshed on expiry) ────────────────────────────────

let cachedToken    = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;

  if (!CONSUMER_KEY || !CONSUMER_SECRET) {
    throw new Error('MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET are not configured');
  }

  const credentials = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${MPESA_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`M-Pesa OAuth failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken    = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in) * 1000);
  return cachedToken;
}

// ─── Generate password ────────────────────────────────────────────────────────
// Daraja requires: base64(shortcode + passkey + timestamp)

function generatePassword(timestamp) {
  const raw = `${SHORTCODE}${PASSKEY}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

function getTimestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

// ─── Normalise phone to Daraja format ─────────────────────────────────────────
// Daraja requires: 2547XXXXXXXX (no + prefix)

function normalisePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return digits;
  if (digits.startsWith('07') && digits.length === 10)  return '254' + digits.slice(1);
  if (digits.startsWith('01') && digits.length === 10)  return '254' + digits.slice(1);
  if (digits.startsWith('2547') || digits.startsWith('2541')) return digits;
  throw new Error(`Cannot normalise phone for M-Pesa: ${phone}`);
}

// ─── Initiate STK Push ────────────────────────────────────────────────────────
// Sends a payment prompt to the customer's phone.
// Returns { CheckoutRequestID, MerchantRequestID } on success.

async function initiateSTKPush({ phone, amount, jobId, description }) {
  if (!PASSKEY || !CALLBACK_URL) {
    throw new Error('MPESA_PASSKEY and MPESA_CALLBACK_URL are required for real M-Pesa payments');
  }

  const token      = await getAccessToken();
  const timestamp  = getTimestamp();
  const password   = generatePassword(timestamp);
  const normPhone  = normalisePhone(phone);

  const body = {
    BusinessShortCode: SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.ceil(amount),    // must be integer KES, round up
    PartyA:            normPhone,            // customer phone
    PartyB:            SHORTCODE,
    PhoneNumber:       normPhone,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  jobId,
    TransactionDesc:   description || `RoadReady Job ${jobId}`,
  };

  const res = await fetch(`${MPESA_BASE}/mpesa/stkpush/v1/processrequest`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(`STK Push failed: ${data.errorMessage || data.ResponseDescription || JSON.stringify(data)}`);
  }

  console.log(JSON.stringify({
    level: 'INFO', event: 'mpesa_stk_initiated',
    jobId, phone: normPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    checkoutRequestId: data.CheckoutRequestID,
    amount,
  }));

  return {
    checkoutRequestId:  data.CheckoutRequestID,
    merchantRequestId:  data.MerchantRequestID,
    customerMessage:    data.CustomerMessage,
  };
}

// ─── Query STK Push status ────────────────────────────────────────────────────
// Polls the status of a payment. Use sparingly — prefer the callback.

async function querySTKStatus(checkoutRequestId) {
  const token     = await getAccessToken();
  const timestamp = getTimestamp();

  const res = await fetch(`${MPESA_BASE}/mpesa/stkpushquery/v1/query`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      BusinessShortCode: SHORTCODE,
      Password:          generatePassword(timestamp),
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  const data = await res.json();
  return {
    resultCode:    data.ResultCode,
    resultDesc:    data.ResultDesc,
    completed:     data.ResultCode === '0',
    cancelled:     ['1032','1037'].includes(data.ResultCode),
    insufficient:  data.ResultCode === '1',
  };
}

// ─── Parse Daraja callback ────────────────────────────────────────────────────
// Call this in your callback route handler with req.body.

function parseCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback) return null;

  const { ResultCode, ResultDesc, CheckoutRequestID, MerchantRequestID, CallbackMetadata } = callback;

  const meta    = CallbackMetadata?.Item || [];
  const find    = (name) => meta.find(i => i.Name === name)?.Value;

  return {
    checkoutRequestId: CheckoutRequestID,
    merchantRequestId: MerchantRequestID,
    resultCode:        ResultCode,
    resultDesc:        ResultDesc,
    success:           ResultCode === 0,
    mpesaReceiptNumber:find('MpesaReceiptNumber'),
    transactionDate:   find('TransactionDate'),
    phoneNumber:       find('PhoneNumber'),
    amount:            find('Amount'),
  };
}

module.exports = { initiateSTKPush, querySTKStatus, parseCallback, normalisePhone };
