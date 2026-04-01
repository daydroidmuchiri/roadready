/**
 * RoadReady — Rate Limiter Middleware
 *
 * All express-rate-limit instances live here so the bypass logic
 * is in one place.  In NODE_ENV=test every limiter is replaced by
 * a simple pass-through so repeated calls to the same phone number
 * (e.g. loginViaOTP helper in server.test.js) never get blocked.
 */

'use strict';

const rateLimit = require('express-rate-limit');

const IS_TEST = process.env.NODE_ENV === 'test';

/** No-op middleware — passes straight through */
const bypass = (_req, _res, next) => next();

// ─── Global limiter (applied to all routes) ───────────────────────────────────
const globalLimiter = IS_TEST
  ? bypass
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down.' } },
    });

// ─── Auth limiter (applied to /api/auth/*) ────────────────────────────────────
const authLimiter = IS_TEST
  ? bypass
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      skipSuccessfulRequests: true,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Wait 15 minutes.' } },
    });

// ─── AI limiter (applied to /api/ai/* routes) ─────────────────────────────────
const aiLimiter = IS_TEST
  ? bypass
  : rateLimit({
      windowMs: 60 * 1000,
      max: 20,
      message: { error: { code: 'RATE_LIMITED', message: 'AI rate limit reached — wait a moment.' } },
    });

// ─── OTP send limiter (applied to /api/auth/otp/send|resend) ─────────────────
// Stricter than the global auth limiter — 3 OTP sends per minute per IP.
const otpSendLimiter = IS_TEST
  ? bypass
  : rateLimit({
      windowMs: 60 * 1000,
      max: 3,
      skipSuccessfulRequests: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many OTP requests. Please wait 1 minute.' } },
    });

module.exports = { globalLimiter, authLimiter, aiLimiter, otpSendLimiter };
