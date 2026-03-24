/**
 * RoadReady — Error Handling Utilities
 * Centralised error types, handler, and async wrapper
 */

// ─── Custom Error Classes ────────────────────────────────────────────────────

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code       = code || 'INTERNAL_ERROR';
    this.isOperational = true;         // distinguishes known errors from bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, fields) {
    super(message, 400, 'VALIDATION_ERROR');
    this.fields = fields || {};        // { fieldName: 'error message' }
  }
}

class AuthError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'AUTH_ERROR');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor() {
    super('Too many requests. Please wait before trying again.', 429, 'RATE_LIMITED');
  }
}

class ExternalServiceError extends AppError {
  constructor(service, message) {
    super(`${service} is unavailable: ${message}`, 503, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

// ─── Async Route Wrapper ─────────────────────────────────────────────────────
// Eliminates the need for try/catch in every async route handler.
// Usage: app.post('/route', asyncHandler(async (req, res) => { ... }))

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ─── Input Validator ─────────────────────────────────────────────────────────
// Lightweight field validator — avoids pulling in heavy libraries.

function validate(data, rules) {
  const errors = {};

  for (const [field, rule] of Object.entries(rules)) {
    const value = data?.[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors[field] = `${field} is required`;
      continue;
    }
    if (value === undefined || value === null) continue;

    if (rule.type === 'string' && typeof value !== 'string') {
      errors[field] = `${field} must be a string`;
    } else if (rule.type === 'number' && typeof value !== 'number') {
      errors[field] = `${field} must be a number`;
    } else if (rule.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors[field] = `${field} must be an object`;
    }

    if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
      errors[field] = `${field} must be at least ${rule.minLength} characters`;
    }
    if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
      errors[field] = `${field} must be at most ${rule.maxLength} characters`;
    }
    if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
      errors[field] = `${field} must be at least ${rule.min}`;
    }
    if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
      errors[field] = `${field} must be at most ${rule.max}`;
    }
    if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
      errors[field] = rule.message || `${field} format is invalid`;
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors[field] = `${field} must be one of: ${rule.enum.join(', ')}`;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Validation failed', errors);
  }
}

// ─── Validation Schemas ──────────────────────────────────────────────────────

const schemas = {
  // register and login are OTP-based — see routes/auth.js
  createJob: {
    serviceId: { required: true, type: 'string' },
    address:   { required: true, type: 'string', minLength: 3, maxLength: 200 },
    location:  { required: true, type: 'object' },
  },
  updateJobStatus: {
    status: {
      required: true, type: 'string',
      enum: ['searching', 'matched', 'en_route', 'on_site', 'in_progress', 'completed', 'cancelled']
    },
  },
  mpesaPayment: {
    jobId: { required: true, type: 'string' },
    phone: { required: true, type: 'string', pattern: /^(07|01|\+2547|\+2541)\d{8}$/, message: 'phone must be a valid Kenyan number' },
  },
  aiMessage: {
    messages: { required: true },   // array — validated separately
  },
  updateLocation: {
    location: { required: true, type: 'object' },
  },
};

// ─── Global Error Handler Middleware ────────────────────────────────────────
// Must be registered as: app.use(globalErrorHandler)
// Must be the LAST middleware added.

function globalErrorHandler(err, req, res, next) {     // eslint-disable-line no-unused-vars
  // Default to 500
  let statusCode = err.statusCode || 500;
  let code       = err.code       || 'INTERNAL_ERROR';
  let message    = err.message    || 'Something went wrong';
  let fields     = err.fields     || undefined;

  // Don't expose internal errors to client in production
  const isProd = process.env.NODE_ENV === 'production';
  const isOperational = err.isOperational === true;

  if (isProd && !isOperational) {
    // Programming error or unknown bug — hide details
    statusCode = 500;
    code       = 'INTERNAL_ERROR';
    message    = 'An unexpected error occurred. Our team has been notified.';
    fields     = undefined;
  }

  // Log everything server-side
  const logLevel = statusCode >= 500 ? 'ERROR' : 'WARN';
  const logEntry = {
    level:      logLevel,
    code,
    statusCode,
    message:    err.message,        // always log real message
    method:     req.method,
    path:       req.path,
    ip:         req.ip,
    userId:     req.user?.id || 'anonymous',
    stack:      isProd ? undefined : err.stack,
    timestamp:  new Date().toISOString(),
  };
  console[logLevel === 'ERROR' ? 'error' : 'warn'](JSON.stringify(logEntry));

  // Report unhandled server errors to Sentry
  if (statusCode >= 500) {
    try { require('./sentry').captureException(err, { userId: req.user?.id, path: req.path }); }
    catch { /* Sentry not available in test env */ }
  }

  // Send clean response
  const response = { error: { code, message } };
  if (fields) response.error.fields = fields;
  if (!isProd) response.error.stack = err.stack;

  res.status(statusCode).json(response);
}

// ─── 404 Handler ─────────────────────────────────────────────────────────────
// Register just before globalErrorHandler to catch unknown routes.

function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

// ─── Process-level Handlers ──────────────────────────────────────────────────
// Call once at app startup.

function registerProcessHandlers() {
  process.on('unhandledRejection', (reason, promise) => {
    console.error(JSON.stringify({
      level: 'FATAL',
      event: 'unhandledRejection',
      reason: reason?.message || String(reason),
      stack: reason?.stack,
      timestamp: new Date().toISOString(),
    }));
    // Give the server a moment to finish in-flight requests, then exit
    // PM2 / Docker will restart the process automatically
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('uncaughtException', (err) => {
    console.error(JSON.stringify({
      level: 'FATAL',
      event: 'uncaughtException',
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
    }));
    setTimeout(() => process.exit(1), 1000);
  });

  // SIGTERM is handled in server.js start() which drains connections before exit
}

// ─── Startup Env Validator ───────────────────────────────────────────────────
// Call before server.listen() — crashes loudly if config is missing.

function validateEnv() {
  const required = ['JWT_SECRET', 'DATABASE_URL'];
  const missing  = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error(`[STARTUP] Missing required environment variables: ${missing.join(', ')}`);
    console.error('[STARTUP] Create a .env file — see README for the full list.');
    process.exit(1);
  }

  if (process.env.JWT_SECRET === 'roadready-secret-change-in-prod') {
    console.warn('[STARTUP] WARNING: JWT_SECRET is set to the default value. Change it in production!');
  }

  console.log('[STARTUP] Environment validated ✓');
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  asyncHandler,
  validate,
  schemas,
  globalErrorHandler,
  notFoundHandler,
  registerProcessHandlers,
  validateEnv,
};
