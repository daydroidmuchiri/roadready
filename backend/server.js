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
const { callClaude } = require('./services/ai.service');

const healthRouter   = require('./routes/health.routes');
const serviceRouter  = require('./routes/service.routes');
const jobRouter      = require('./routes/job.routes');
const providerRouter = require('./routes/provider.routes');
const adminRouter    = require('./routes/admin.routes');
const paymentRouter  = require('./routes/payment.routes');
const aiRouter       = require('./routes/ai.routes');
const { auth }       = require('./middleware/auth.middleware');

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



app.use('/health', healthRouter);
app.use('/api/services', serviceRouter);
app.use('/api/jobs', jobRouter);
app.use('/api/providers', providerRouter);
app.use('/api/analytics', adminRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/ai', aiRouter);


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
