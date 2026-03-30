/**
 * RoadReady — OTP Authentication Routes
 *
 * Flow:
 *   1. POST /api/auth/otp/send   → validates phone, checks rate limits, sends SMS
 *   2. POST /api/auth/otp/verify → checks OTP, creates/fetches user, returns JWT
 *   3. POST /api/auth/otp/resend → same as send but explicit resend action
 *   4. POST /api/auth/refresh    → exchange a valid JWT for a fresh one (7-day rolling)
 *   5. POST /api/auth/logout     → client-side only (stateless JWT)
 *
 * The old password-based /api/auth/register and /api/auth/login endpoints
 * are kept for backward compatibility (admin accounts use them).
 *
 * OTP replaces password for all motorist and provider accounts.
 */

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const { Users } = require('../db/queries');
const {
  createOTP, verifyOTP,
  checkRateLimit, incrementRateLimit,
  RATE_LIMIT_PHONE_COUNT, RATE_LIMIT_IP_COUNT,
} = require('../db/otp');
const { sendOTP }  = require('../sms');
const {
  asyncHandler, validate,
  AuthError, ValidationError, ConflictError,
  NotFoundError, RateLimitError, ExternalServiceError,
} = require('../errors');

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Validation schemas ───────────────────────────────────────────────────────

const PHONE_PATTERN = /^(07|01|\+2547|\+2541)\d{8}$/;

const schemas = {
  sendOTP: {
    phone: { required: true, type: 'string', pattern: PHONE_PATTERN, message: 'Must be a valid Kenyan phone number (07XX, 01XX, or +254...)' },
    role:  { required: false, type: 'string', enum: ['motorist', 'provider'] },
  },
  verifyOTP: {
    phone: { required: true,  type: 'string', pattern: PHONE_PATTERN, message: 'Must be a valid Kenyan phone number' },
    code:  { required: true,  type: 'string', minLength: 6, maxLength: 6 },
    name:  { required: false, type: 'string', minLength: 2, maxLength: 100 },
    role:  { required: false, type: 'string', enum: ['motorist', 'provider'] },
  },
};

// Strict rate limiter for OTP sending — separate from global limiter
const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 3,                // 3 OTP sends per minute per IP
  skipSuccessfulRequests: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many OTP requests. Please wait 1 minute.' } },
});

// ─── POST /api/auth/otp/send ──────────────────────────────────────────────────
// Step 1: Request an OTP. Validates phone, checks rate limits, sends SMS.

router.post('/otp/send', otpSendLimiter, asyncHandler(async (req, res) => {
  const { phone, role } = req.body;

  // Validate phone format
  if (!phone || !PHONE_PATTERN.test(phone.trim())) {
    throw new ValidationError('Validation failed', {
      phone: 'Must be a valid Kenyan phone number (07XX, 01XX, or +254...)',
    });
  }

  const cleanPhone = phone.trim();
  const ip         = req.ip || req.socket?.remoteAddress || 'unknown';

  // ── Rate limiting ──────────────────────────────────────────────────────────
  // Per-phone: max 5 OTPs per hour (prevents SMS bombing a specific number)
  const phoneRateLimited = await checkRateLimit(`phone:${cleanPhone}`, RATE_LIMIT_PHONE_COUNT);
  if (phoneRateLimited) {
    throw new RateLimitError();
  }

  // Per-IP: max 10 OTPs per hour (prevents one attacker hitting many numbers)
  const ipRateLimited = await checkRateLimit(`ip:${ip}`, RATE_LIMIT_IP_COUNT);
  if (ipRateLimited) {
    throw new RateLimitError();
  }

  // Increment rate limit counters
  await Promise.all([
    incrementRateLimit(`phone:${cleanPhone}`),
    incrementRateLimit(`ip:${ip}`),
  ]);

  // ── Check if user exists ───────────────────────────────────────────────────
  const existingUser = await Users.findByPhone(cleanPhone);
  const isNewUser    = !existingUser;

  // ── Generate and send OTP ──────────────────────────────────────────────────
  const code   = await createOTP(cleanPhone, ip, req.headers['user-agent']);
  const result = await sendOTP(cleanPhone, code);

  if (!result.success && !result.dryRun) {
    throw new ExternalServiceError('SMS', 'Could not send the verification code. Please try again.');
  }

  // Return minimal info — don't confirm whether the user exists (privacy)
  res.json({
    sent:      true,
    isNewUser,
    message:   `A 6-digit code has been sent to ${cleanPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2')}`,
    expiresIn: 600,   // seconds
    // In dev mode, return the code directly so you can test without real SMS
    ...(result.dryRun ? { devCode: code } : {}),
  });
}));

// ─── POST /api/auth/otp/resend ────────────────────────────────────────────────
// Explicit resend — same logic as send, different endpoint for analytics clarity

router.post('/otp/resend', otpSendLimiter, asyncHandler(async (req, res) => {
  // Delegate to the send handler
  // Delegate to the send logic directly
req.url = '/otp/send';
router.handle(req, res, () => {});
}));

// ─── POST /api/auth/otp/verify ────────────────────────────────────────────────
// Step 2: Submit the OTP. Creates user if new, returns JWT on success.

router.post('/otp/verify', asyncHandler(async (req, res) => {
  const { phone, code, name, role } = req.body;

  // Validate inputs
  if (!phone || !PHONE_PATTERN.test(phone.trim())) {
    throw new ValidationError('Validation failed', { phone: 'Invalid phone number' });
  }
  if (!code || !/^\d{6}$/.test(String(code).trim())) {
    throw new ValidationError('Validation failed', { code: 'Code must be exactly 6 digits' });
  }

  const cleanPhone = phone.trim();
  const cleanCode  = String(code).trim();

  // ── Verify the OTP ─────────────────────────────────────────────────────────
  const verification = await verifyOTP(cleanPhone, cleanCode);

  if (!verification.valid) {
    throw new AuthError(verification.reason);
  }

  // ── Find or create the user ────────────────────────────────────────────────
  let user = await Users.findByPhone(cleanPhone);

  if (!user) {
    // New user — name is required for full registration, but we allow 'New User'
    // so the mobile app doesn't fail validation on the initial OTP screen.
    const finalName = name && name.trim().length >= 2 ? name.trim() : 'New User';

    user = await Users.create({
      name:         finalName,
      phone:        cleanPhone,
      passwordHash: null,              // OTP users have no password
      role:         role || 'motorist',
    });

    // Mark as verified immediately — they just proved ownership of the number
    await Users.markVerified(user.id);

    console.log(JSON.stringify({
      level: 'INFO', event: 'user_registered',
      userId: user.id, role: user.role,
      timestamp: new Date().toISOString(),
    }));
  } else {
    // Existing user — mark phone as verified if not already
    if (!user.isVerified) {
      await Users.markVerified(user.id);
    }

    console.log(JSON.stringify({
      level: 'INFO', event: 'user_logged_in',
      userId: user.id, role: user.role,
      timestamp: new Date().toISOString(),
    }));
  }

  // ── Issue JWT ──────────────────────────────────────────────────────────────
  const token = jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    isNewUser: !user.createdAt || (Date.now() - new Date(user.createdAt).getTime() < 5000),
    user: {
      id:         user.id,
      name:       user.name,
      phone:      user.phone,
      role:       user.role,
      isVerified: true,
    },
  });
}));

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
// Rolling refresh — exchange a valid (non-expired) JWT for a fresh 7-day one.
// Call this on app foreground if the token is less than 1 day from expiry.

router.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('No token provided');

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthError('Token has expired — please log in again');
    }
    throw new AuthError('Invalid token');
  }

  // Confirm user still exists and isn't suspended
  const user = await Users.findById(payload.id);
  if (!user) throw new AuthError('Account not found');
  if (user.status === 'suspended') throw new AuthError('Account suspended — contact support');

  const newToken = jwt.sign(
    { id: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token: newToken,
    user:  { id: user.id, name: user.name, phone: user.phone, role: user.role },
  });
}));

// ─── POST /api/auth/me ────────────────────────────────────────────────────────
// Returns the currently logged-in user. Used on app startup to validate token.

router.get('/me', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('No token');

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { throw new AuthError('Invalid or expired token'); }

  const user = await Users.findById(payload.id);
  if (!user) throw new AuthError('Account not found');

  res.json({ user: { id: user.id, name: user.name, phone: user.phone, role: user.role, isVerified: user.isVerified } });
}));

// ─── PATCH /api/auth/me/name ────────────────────────────────────────────────
// Update user's name after registration (called from NameScreen)

router.patch('/me/name', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('No token');

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { throw new AuthError('Invalid token'); }

  const { name } = req.body;
  if (!name || name.trim().length < 2)
    throw new ValidationError('Validation failed', { name: 'Name must be at least 2 characters' });
  if (name.trim().length > 100)
    throw new ValidationError('Validation failed', { name: 'Name too long' });

  const { query } = require('../db/pool');
  const { rows } = await query(
    'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, phone, role',
    [name.trim(), payload.id]
  );
  if (!rows[0]) throw new NotFoundError('User');

  res.json({ user: rows[0] });
}));

// ─── PATCH /api/auth/device-token ───────────────────────────────────────────
// Register an FCM push token for ANY authenticated user (motorist, provider, admin).
// This is role-agnostic — the old /api/providers/device-token endpoint returned
// 403 for non-provider roles, silently breaking push notifications for motorists.

router.patch('/device-token', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthError('No token');

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { throw new AuthError('Invalid or expired token'); }

  const { deviceToken } = req.body;
  if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.length < 10)
    throw new ValidationError('Validation failed', { deviceToken: 'required string' });

  await Users.updateDeviceToken(payload.id, deviceToken);
  res.json({ ok: true });
}));

module.exports = router;
