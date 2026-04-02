/**
 * RoadReady Backend API — PostgreSQL Edition
 * Node.js + Express + Socket.IO + PostgreSQL + Claude API
 */

// ─── Process-level handlers FIRST ────────────────────────────────────────────
const {
  asyncHandler, validate, schemas,
  globalErrorHandler, notFoundHandler,
  registerProcessHandlers, validateEnv,
  AuthError, NotFoundError, ConflictError,
  ValidationError, ExternalServiceError, ForbiddenError,
} = require('./errors');

registerProcessHandlers();

require('dotenv').config();
validateEnv();

// ─── Sentry — init BEFORE all other requires ────────────────────────────────
const Sentry = require('./sentry');
Sentry.init();

// ─── Imports ─────────────────────────────────────────────────────────────────
const express    = require('express');
const http       = require('http');
const { initSocket, emitToJob, emitToUser, emitToAdmins } = require('./services/socket.service');
const { assignBestProvider } = require('./services/dispatch.service');
const cors       = require('cors');
const helmet     = require('helmet');
const { globalLimiter, authLimiter, aiLimiter } = require('./middleware/rateLimiter.middleware');
const morgan     = require('morgan');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const Anthropic  = require('@anthropic-ai/sdk');

// ─── Database ─────────────────────────────────────────────────────────────────
const { checkConnection, closePool } = require('./db/pool');
const { Users, Services, Jobs, Payments, Analytics, ProviderProfiles } = require('./db/queries');
// --- Notifications ---
const {
  notifyProviderNewJob,
  notifyProviderJobCancelled,
  notifyMotoristProviderMatched,
  notifyMotoristProviderArrived,
  notifyMotoristJobComplete,
  notifyMotoristPaymentConfirmed,
  notifyMotoristNoProviders,
  notifyMotoristJobCancelled,
  notifyAdminsJobStuck,
} = require('./notifications/templates');

// ─── Routes ───────────────────────────────────────────────────────────────────
const mapsRouter    = require('./routes/maps');
const authRouter    = require('./routes/auth');
const uploadsRouter = require('./routes/uploads');
const payoutsRouter = require('./routes/payouts');
const { initiateSTKPush, parseCallback } = require('./mpesa');


const app       = express();
const server    = http.createServer(app);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const JWT_SECRET    = process.env.JWT_SECRET;
const PORT          = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = initSocket(server);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(Sentry.requestHandler());   // must be first middleware
app.use(helmet());
app.set('trust proxy', 1);
app.use(cors({
  origin: (origin, cb) => {
    const allowed = [CLIENT_ORIGIN, 'http://localhost:3000', 'http://localhost:19006'];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Defined in middleware/rateLimiter.middleware.js — bypassed in NODE_ENV=test

app.use(globalLimiter);
app.use('/api/auth', authRouter);
app.use('/api/maps',    auth, mapsRouter);
app.use('/api/uploads', auth, uploadsRouter);
app.use('/api/payouts', auth, payoutsRouter);



// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', asyncHandler(async (req, res) => {
  const dbOk = await checkConnection();
  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? 'ok' : 'degraded',
    db:        dbOk ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
}));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next(new AuthError('No token provided'));
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AuthError('Token expired — please log in again'));
    next(new AuthError('Invalid token'));
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role))
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    next();
  };
}

// ─── Auth Routes (OTP-based — see routes/auth.js) ────────────────────────────
// All auth: /api/auth/otp/send, /otp/verify, /refresh, /me, /me/name
// ─── Services ────────────────────────────────────────────────────────────────
app.get('/api/services', asyncHandler(async (req, res) => {
  const services = await Services.list();
  res.json(services);
}));

// ─── Jobs ────────────────────────────────────────────────────────────────────
app.post('/api/jobs', auth, requireRole('motorist'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.createJob);
  const { serviceId, location, address } = req.body;

  if (typeof location.lat !== 'number' || typeof location.lng !== 'number')
    throw new ValidationError('Validation failed', { location: 'must have numeric lat and lng' });
  if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180)
    throw new ValidationError('Validation failed', { location: 'coordinates out of range' });

  const service = await Services.findById(serviceId);
  if (!service) throw new NotFoundError('Service');

  const activeJobs = await Jobs.findActiveByMotorist(req.user.id);
  if (activeJobs.length > 0)
    throw new ConflictError(`You already have active job ${activeJobs[0].id}. Complete or cancel it first.`);

  const job = await Jobs.create({
    motoristId: req.user.id,
    serviceId,
    price:      service.price,
    commission: service.commission,
    address:    address.trim(),
    lat:        location.lat,
    lng:        location.lng,
  });

  emitToAdmins('new_job', { ...job, serviceName: service.name, serviceEmoji: service.emoji });

  // Auto-dispatch after 5s
  setTimeout(() => assignBestProvider(job.id, serviceId, location.lat, location.lng), 5000);

  res.status(201).json(job);
}));

app.get('/api/jobs', auth, asyncHandler(async (req, res) => {
  let jobs;
  if (req.user.role === 'motorist')       jobs = await Jobs.listByMotorist(req.user.id);
  else if (req.user.role === 'provider')  jobs = await Jobs.listByProvider(req.user.id);
  else                                    jobs = await Jobs.listAll();
  res.json(jobs);
}));

app.get('/api/jobs/:id', auth, asyncHandler(async (req, res) => {
  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');
  if (req.user.role === 'motorist' && job.motoristId !== req.user.id)
    throw new ForbiddenError('You do not have access to this job');
  res.json(job);
}));

app.patch('/api/jobs/:id/status', auth, asyncHandler(async (req, res) => {
  validate(req.body, schemas.updateJobStatus);

  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');

  if (req.user.role === 'provider' && job.providerId !== req.user.id)
    throw new ForbiddenError('You are not assigned to this job');

  // Role-specific valid transitions:
  //   Provider: advances jobs forward (en_route → on_site → in_progress → completed)
  //   Motorist: can only cancel
  //   Admin: can do anything
  //   'matched' is set ONLY by the dispatch algorithm, never by API clients
  const roleTransitions = {
    admin:    { searching: ['cancelled'], matched: ['en_route','cancelled'], en_route: ['on_site','cancelled'], on_site: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [] },
    provider: { searching: [], matched: ['en_route','cancelled'], en_route: ['on_site','cancelled'], on_site: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [] },
    motorist: { searching: ['cancelled'], matched: ['cancelled'], en_route: ['cancelled'], on_site: [], in_progress: [], completed: [], cancelled: [] },
  };
  const validTransitions = roleTransitions[req.user.role] || {};
  if (!validTransitions[job.status]?.includes(req.body.status))
    throw new ValidationError('Invalid status transition', {
      status: `Cannot move from '${job.status}' to '${req.body.status}'`,
    });

  const updated = await Jobs.updateStatus(req.params.id, req.body.status, {
    cancelReason: req.body.cancelReason,
  });

  emitToJob(updated.id, updated.motoristId, updated.providerId, 'job_updated', updated);

  // ── Push notifications per status transition ────────────────────────────
  const newStatus = req.body.status;
  const providerName = job.providerName || 'Your provider';

  if (newStatus === 'on_site' && job.motoristId) {
    // Provider arrived — notify motorist
    notifyMotoristProviderArrived(job.motoristId, updated, providerName).catch(() => {});
  }

  if (newStatus === 'completed' && job.motoristId) {
    // Job done — notify motorist to rate and pay
    notifyMotoristJobComplete(job.motoristId, updated, providerName).catch(() => {});
  }

  if (newStatus === 'cancelled') {
    const reason = req.body.cancelReason || null;
    // Notify the OTHER party
    if (req.user.role === 'motorist' && job.providerId) {
      // Motorist cancelled — notify provider
      notifyProviderJobCancelled(job.providerId, { ...job, serviceName: job.serviceName }).catch(() => {});
    }
    if (req.user.role === 'provider' && job.motoristId) {
      // Provider cancelled — notify motorist
      notifyMotoristJobCancelled(job.motoristId, updated, reason).catch(() => {});
    }
  }
  // ──────────────────────────────────────────────────────────────────────

  res.json(updated);
}));

// Submit a rating after job completion
app.post('/api/jobs/:id/rating', auth, asyncHandler(async (req, res) => {
  const { rating } = req.body;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ValidationError('Validation failed', { rating: 'must be an integer between 1 and 5' });

  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');
  if (job.status !== 'completed') throw new ConflictError('Can only rate completed jobs');
  if (req.user.role === 'motorist' && job.motoristId !== req.user.id)
    throw new ForbiddenError('Not your job');

  const updated = await Jobs.submitRating(req.params.id, req.user.role, rating);
  res.json(updated);
}));

// ─── Providers ───────────────────────────────────────────────────────────────
app.get('/api/providers', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const providers = await Users.listProviders();
  res.json(providers);
}));

app.get('/api/providers/me', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  const [user, profile, todayStats, recentJobs] = await Promise.all([
    Users.findById(req.user.id),
    ProviderProfiles.findByUserId(req.user.id),
    ProviderProfiles.todayEarnings(req.user.id),
    Jobs.listByProvider(req.user.id),
  ]);
  if (!user) throw new NotFoundError('Provider');
  res.json({
    ...user,
    profile,
    todayEarnings: Number(todayStats?.todayEarnings) || 0,
    todayJobs:     Number(todayStats?.todayJobs)     || 0,
    recentJobs:    recentJobs.slice(0, 10),
  });
}));

app.patch('/api/providers/location', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.updateLocation);
  const { location } = req.body;
  if (typeof location.lat !== 'number' || typeof location.lng !== 'number')
    throw new ValidationError('Validation failed', { location: 'must have numeric lat and lng' });

  await Users.updateLocation(req.user.id, location.lat, location.lng);
  // Location from REST endpoint — emit via scoped helper
  io.to('admins').emit('provider_location', { providerId: req.user.id, location });
  res.json({ ok: true });
}));

app.patch('/api/providers/status', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['available','offline'].includes(status))
    throw new ValidationError('Validation failed', { status: 'must be available or offline' });

  const updated = await Users.updateStatus(req.user.id, status);
  io.emit('provider_status', { providerId: req.user.id, status });
  res.json(updated);
}));

app.patch('/api/providers/device-token', auth, asyncHandler(async (req, res) => {
  const { deviceToken } = req.body;
  if (!deviceToken || typeof deviceToken !== 'string')
    throw new ValidationError('Validation failed', { deviceToken: 'required string' });
  await Users.updateDeviceToken(req.user.id, deviceToken);
  res.json({ ok: true });
}));

// ─── Analytics ───────────────────────────────────────────────────────────────
app.get('/api/analytics/dashboard', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const data = await Analytics.dashboard();
  res.json(data);
}));

// ─── M-Pesa Payment ──────────────────────────────────────────────────────────
app.post('/api/payments/mpesa', auth, requireRole('motorist'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.mpesaPayment);
  const { jobId, phone } = req.body;

  const job = await Jobs.findById(jobId);
  if (!job)                           throw new NotFoundError('Job');
  if (job.motoristId !== req.user.id) throw new ForbiddenError('This is not your job');
  if (job.status === 'completed')     throw new ConflictError('This job has already been paid');
  if (job.status === 'cancelled')     throw new ConflictError('Cannot pay for a cancelled job');

  // Create a pending payment record first
  const payment = await Payments.create({
    jobId,
    motoristId: req.user.id,
    amount:     job.price,
    mpesaPhone: phone,
  });

  // Use real Daraja STK Push if configured, otherwise simulate (dev mode)
  let checkoutRequestId, merchantRequestId, customerMessage;

  const mpesaConfigured = process.env.MPESA_CONSUMER_KEY && process.env.MPESA_PASSKEY && process.env.MPESA_CALLBACK_URL;

  if (mpesaConfigured) {
    // ── Production: real M-Pesa STK Push ──────────────────────────────────
    try {
      const mpesaResult = await initiateSTKPush({
        phone,
        amount:      job.price,
        jobId,
        description: `RoadReady - ${job.serviceId}`,
      });
      checkoutRequestId = mpesaResult.checkoutRequestId;
      merchantRequestId = mpesaResult.merchantRequestId;
      customerMessage   = mpesaResult.customerMessage;
    } catch (err) {
      throw new ExternalServiceError('M-Pesa', err.message);
    }
  } else {
    // ── Dev/staging: simulate payment ─────────────────────────────────────
    checkoutRequestId = 'RR-SIM-' + Date.now();
    merchantRequestId = 'MR-SIM-' + Date.now();
    customerMessage   = `[DEV] Simulated payment of KES ${job.price.toLocaleString()} to ${phone}`;

    setTimeout(async () => {
      try {
        const confirmed = await Payments.confirmByCheckoutId(checkoutRequestId, 'SIM' + Date.now());
        if (confirmed) {
          const updatedJob = await Jobs.findById(jobId);
          if (updatedJob?.motoristId) emitToJob(jobId, updatedJob.motoristId, updatedJob.providerId, 'payment_confirmed', { jobId, ref: checkoutRequestId });
          if (updatedJob?.motoristId) emitToJob(jobId, updatedJob.motoristId, updatedJob.providerId, 'job_updated', updatedJob);
          if (updatedJob?.motoristId) notifyMotoristPaymentConfirmed(updatedJob.motoristId, updatedJob, checkoutRequestId).catch(()=>{});
        }
      } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', event: 'sim_payment_failed', message: err.message }));
      }
    }, 3000);
  }

  await Payments.updateCheckoutRequestId(payment.id, checkoutRequestId, merchantRequestId);

  res.json({ success: true, checkoutRequestId, customerMessage });
}));

// M-Pesa callback endpoint (called by Safaricom in production)
app.post('/api/payments/mpesa/callback', asyncHandler(async (req, res) => {
  const parsed = parseCallback(req.body);
  if (!parsed) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const { checkoutRequestId: CheckoutRequestID, success, resultDesc, mpesaReceiptNumber: receipt } = parsed;

  if (success) {
    const payment = await Payments.confirmByCheckoutId(CheckoutRequestID, receipt);
    // Fix: payment may be null if this is a duplicate callback from Safaricom (they retry)
    // confirmByCheckoutId uses a transaction so duplicates are safely ignored
    if (payment?.jobId) {
      const job = await Jobs.findById(payment.jobId);
      if (job) {
        emitToJob(job.id, job.motoristId, job.providerId, 'payment_confirmed', { jobId: job.id, ref: CheckoutRequestID });
        emitToJob(job.id, job.motoristId, job.providerId, 'job_updated', job);
        notifyMotoristPaymentConfirmed(job.motoristId, job, receipt).catch(() => {});
      }
    }
  } else {
    await Payments.failByCheckoutId(CheckoutRequestID, resultDesc || 'Payment failed');
    emitToAdmins('payment_failed', { checkoutRequestId: CheckoutRequestID, reason: resultDesc });
  }

  // Always return 200 to Safaricom — they retry otherwise
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// ─── AI Endpoints ─────────────────────────────────────────────────────────────
async function callClaude(params) {
  try {
    return await anthropic.messages.create(params);
  } catch (err) {
    if (err.status === 529 || err.status === 503)
      throw new ExternalServiceError('AI', 'temporarily overloaded — try again shortly');
    if (err.status === 401) throw new ExternalServiceError('AI', 'authentication failed');
    if (err.status === 429) throw new ExternalServiceError('AI', 'quota exceeded');
    throw new ExternalServiceError('AI', err.message || 'unknown error');
  }
}

app.post('/api/ai/diagnose', auth, aiLimiter, asyncHandler(async (req, res) => {
  validate(req.body, schemas.aiMessage);
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });
  if (messages.length > 20)
    throw new ValidationError('Validation failed', { messages: 'max 20 messages' });

  const response = await callClaude({
    model: 'claude-sonnet-4-20250514', max_tokens: 400,
    system: `You are RoadReady AI — a friendly roadside assistance diagnostic expert for motorists in Nairobi, Kenya.
When given a breakdown description: 1) identify likely cause 2) give 1-2 safety steps 3) recommend RoadReady service with price in KES 4) add a reassuring sentence. Max 120 words.`,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
  });
  res.json({ reply: response.content[0].text });
}));

app.post('/api/ai/dispatch', auth, requireRole('admin'), aiLimiter, asyncHandler(async (req, res) => {
  validate(req.body, schemas.aiMessage);
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    throw new ValidationError('Validation failed', { messages: 'must be a non-empty array' });

  // Pull live data from the real database
  const [activeJobs, availableProviders] = await Promise.all([
    Jobs.listAll({ status: 'searching' }),
    Users.listProviders().then(ps => ps.filter(p => p.status === 'available')),
  ]);

  const response = await callClaude({
    model: 'claude-sonnet-4-20250514', max_tokens: 600,
    system: `You are RoadReady AI Dispatch. Live data: ${JSON.stringify({ activeJobs, availableProviders, timestamp: new Date().toISOString() })}. Be concise and actionable.`,
    messages: messages.map(m => ({ role: m.role, content: String(m.content) })),
  });
  res.json({ reply: response.content[0].text });
}));

// ─── Dispatch Logic relocated ────────────────────────────────────────────────


// ─── 404 + Error handler — MUST be last ──────────────────────────────────────
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  // ── Database connection (with retry for cold starts on Railway/Render) ───────
  let dbOk = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    dbOk = await checkConnection();
    if (dbOk) break;
    console.warn(`[STARTUP] DB attempt ${attempt}/5 failed — retrying in 3s...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!dbOk) {
    console.error('[STARTUP] Cannot connect to database after 5 attempts. Check DATABASE_URL.');
    process.exit(1);
  }

  // ── Start HTTP server ─────────────────────────────────────────────────────
  // Railway injects PORT automatically. '0.0.0.0' required for Railway/Render.
  // Migrations run before this via `npm start` (node db/migrate.js && node server.js)
  server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({
      level:     'INFO',
      event:     'server_started',
      port:      PORT,
      env:       process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    }));
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Railway sends SIGTERM before killing the process.
  // Give in-flight requests 10s to finish before closing.
  process.on('SIGTERM', () => {
    console.log(JSON.stringify({ level: 'INFO', event: 'sigterm_received' }));
    server.close(async () => {
      await closePool();
      console.log(JSON.stringify({ level: 'INFO', event: 'graceful_shutdown_complete' }));
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => process.exit(1), 10000);
  });
}

start();
module.exports = { app, server };
