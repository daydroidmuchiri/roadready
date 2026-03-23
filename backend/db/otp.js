/**
 * RoadReady — OTP Database Queries
 *
 * All OTP-related database operations.
 * Kept separate from queries.js for clarity.
 */

const bcrypt           = require('bcryptjs');
const crypto           = require('crypto');
const { query, transaction } = require('./pool');

const OTP_EXPIRY_MINUTES  = 10;
const OTP_MAX_ATTEMPTS    = 5;
const OTP_LENGTH          = 6;

// Rate limiting: max OTPs per window
const RATE_LIMIT_PHONE_COUNT  = 5;   // max 5 OTPs per phone per hour
const RATE_LIMIT_IP_COUNT     = 10;  // max 10 OTPs per IP per hour
const RATE_LIMIT_WINDOW_MINS  = 60;

// ─── Generate a secure random OTP ────────────────────────────────────────────

function generateCode() {
  // crypto.randomInt gives cryptographically secure integers
  const code = crypto.randomInt(100000, 999999).toString();
  return code;
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

async function checkRateLimit(key, maxCount) {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINS * 60 * 1000);

  const { rows } = await query(
    `SELECT COALESCE(SUM(count), 0) AS total
     FROM otp_rate_limits
     WHERE key = $1 AND window_start >= $2`,
    [key, windowStart]
  );

  return parseInt(rows[0].total) >= maxCount;
}

async function incrementRateLimit(key) {
  // Upsert: increment count for current hour window
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);   // round down to hour

  await query(
    `INSERT INTO otp_rate_limits (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start)
     DO UPDATE SET count = otp_rate_limits.count + 1`,
    [key, windowStart]
  );
}

// ─── Create and store an OTP ──────────────────────────────────────────────────

async function createOTP(phone, ipAddress, userAgent) {
  const code = generateCode();

  // Hash the code — never store plaintext OTPs
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await transaction(async (client) => {
    // Invalidate any existing active OTPs for this phone
    await client.query(
      `UPDATE otp_codes SET used = TRUE, used_at = NOW()
       WHERE phone = $1 AND used = FALSE AND expires_at > NOW()`,
      [phone]
    );

    // Create the new OTP
    await client.query(
      `INSERT INTO otp_codes
         (phone, code_hash, expires_at, max_attempts, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [phone, codeHash, expiresAt, OTP_MAX_ATTEMPTS, ipAddress, userAgent]
    );
  });

  return code;   // Return plaintext code to be sent via SMS
}

// ─── Verify an OTP ────────────────────────────────────────────────────────────
// Returns { valid: true } or { valid: false, reason: '...' }

async function verifyOTP(phone, submittedCode) {
  return transaction(async (client) => {
    // Get the most recent active OTP for this phone
    const { rows } = await client.query(
      `SELECT * FROM otp_codes
       WHERE phone = $1
         AND used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,   // lock the row to prevent race conditions
      [phone]
    );

    const otpRecord = rows[0];

    if (!otpRecord) {
      return { valid: false, reason: 'No active code found. Please request a new one.' };
    }

    // Check attempt count
    if (otpRecord.attempts >= otpRecord.max_attempts) {
      return { valid: false, reason: 'Too many incorrect attempts. Please request a new code.' };
    }

    // Increment attempt counter immediately (before checking code)
    await client.query(
      'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1',
      [otpRecord.id]
    );

    // Check the code
    const codeMatches = await bcrypt.compare(String(submittedCode), otpRecord.code_hash);

    if (!codeMatches) {
      const attemptsLeft = otpRecord.max_attempts - otpRecord.attempts - 1;
      return {
        valid: false,
        reason: attemptsLeft > 0
          ? `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
      };
    }

    // Mark as used
    await client.query(
      'UPDATE otp_codes SET used = TRUE, used_at = NOW() WHERE id = $1',
      [otpRecord.id]
    );

    return { valid: true };
  });
}

module.exports = {
  generateCode,
  createOTP,
  verifyOTP,
  checkRateLimit,
  incrementRateLimit,
  RATE_LIMIT_PHONE_COUNT,
  RATE_LIMIT_IP_COUNT,
};
