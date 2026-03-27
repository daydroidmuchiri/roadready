/**
 * RoadReady — Sentry Error Tracking
 *
 * Centralized error tracking for backend and mobile apps.
 * Free tier: 5,000 errors/month — more than enough for a Nairobi launch.
 *
 * Setup:
 *   1. Create account at sentry.io (free)
 *   2. Create two projects: "roadready-backend" (Node.js) and "roadready-mobile" (React Native)
 *   3. Copy the DSN for each project
 *   4. Add to .env: SENTRY_DSN=https://...@sentry.io/...
 *
 * This file is used by:
 *   - backend/server.js   (Node.js SDK)
 *   - motorist-app/App.js (React Native SDK)
 *   - provider-app/App.js (React Native SDK)
 *
 * ─────────────────────────────────────────────────────────────────────
 * BACKEND USAGE (server.js)
 * ─────────────────────────────────────────────────────────────────────
 *
 *   const Sentry = require('./sentry-backend');
 *   Sentry.init();
 *
 *   // In globalErrorHandler:
 *   Sentry.captureException(err, { userId: req.user?.id, path: req.path });
 *
 * Install (backend):
 *   npm install @sentry/node @sentry/profiling-node
 *
 * ─────────────────────────────────────────────────────────────────────
 * MOBILE USAGE (App.js)
 * ─────────────────────────────────────────────────────────────────────
 *
 *   import { initSentry, captureException } from '../shared/sentry';
 *   initSentry();   // call once in root App component
 *
 *   // In catch blocks:
 *   captureException(err, { screen: 'TrackingScreen' });
 *
 * Install (mobile):
 *   npx expo install @sentry/react-native
 *   npx sentry-wizard@latest -i reactNative
 */

// ─── BACKEND MODULE ───────────────────────────────────────────────────────────
// Place this file at backend/sentry.js

const Sentry = require('@sentry/node');

let initialised = false;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment:  process.env.NODE_ENV || 'development',
    release:      `roadready-api@${process.env.npm_package_version || '1.0.0'}`,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: null }),   // app injected below
    ],
    tracesSampleRate:   process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Scrub sensitive fields from error reports
    beforeSend(event) {
      if (event.request?.data) {
        const sensitive = ['password', 'code', 'token', 'passwordHash', 'phone'];
        sensitive.forEach(key => {
          if (event.request.data[key]) event.request.data[key] = '[REDACTED]';
        });
      }
      return event;
    },
  });

  initialised = true;
  console.log(`[Sentry] Initialized (env: ${process.env.NODE_ENV || 'development'})`);
}

function requestHandler() {
  return initialised ? Sentry.Handlers.requestHandler() : (req, res, next) => next();
}

function errorHandler() {
  return initialised ? Sentry.Handlers.errorHandler() : (err, req, res, next) => next(err);
}

function captureException(err, context = {}) {
  if (!initialised) return;
  Sentry.withScope(scope => {
    if (context.userId) scope.setUser({ id: context.userId });
    if (context.path)   scope.setTag('path',   context.path);
    if (context.event)  scope.setTag('event',  context.event);
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureException(err);
  });
}

function captureMessage(msg, level = 'info', context = {}) {
  if (!initialised) return;
  Sentry.withScope(scope => {
    Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    Sentry.captureMessage(msg, level);
  });
}

module.exports = { init, requestHandler, errorHandler, captureException, captureMessage };
