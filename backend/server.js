/**
 * RoadReady Backend API - app init and startup shell.
 */

const {
  globalErrorHandler,
  notFoundHandler,
  registerProcessHandlers,
  validateEnv,
} = require('./errors');

registerProcessHandlers();

require('dotenv').config();
validateEnv();

const Sentry = require('./sentry');
Sentry.init();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const Anthropic = require('@anthropic-ai/sdk');

const { globalLimiter, aiLimiter } = require('./middleware/rateLimiter.middleware');
const { createAuthMiddleware, requireRole } = require('./middleware/auth.middleware');
const { checkConnection, closePool } = require('./db/pool');
const { Users, Services, Jobs, Payments, Analytics, ProviderProfiles } = require('./db/queries');
const { createSocketService } = require('./services/socket.service');
const { createDispatchService } = require('./services/dispatch.service');
const { createPaymentService } = require('./services/payment.service');
const { createHealthRouter } = require('./routes/health.routes');
const { createJobRouter } = require('./routes/job.routes');
const { createProviderRouter } = require('./routes/provider.routes');
const { createAdminRouter } = require('./routes/admin.routes');
const { createAiRouter } = require('./routes/ai.routes');
const { createPaymentRouter } = require('./routes/payment.routes');
const { createPayoutCallbackRouter } = require('./routes/payoutCallbacks.routes');
const mapsRouter = require('./routes/maps');
const authRouter = require('./routes/auth');
const uploadsRouter = require('./routes/uploads');
const payoutsRouter = require('./routes/payouts');
const { initiateSTKPush, parseCallback } = require('./mpesa');
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

const app = express();
const server = http.createServer(app);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET;
const auth = createAuthMiddleware(JWT_SECRET);

const socketService = createSocketService({
  server,
  clientOrigin: CLIENT_ORIGIN,
  jwtSecret: JWT_SECRET,
  Users,
  Jobs,
});

const dispatchService = createDispatchService({
  Users,
  Jobs,
  notifyProviderNewJob,
  notifyMotoristProviderMatched,
  notifyMotoristNoProviders,
  notifyAdminsJobStuck,
  emitToJob: socketService.emitToJob,
});

const paymentService = createPaymentService({
  Payments,
  Jobs,
  initiateSTKPush,
  parseCallback,
  emitToJob: socketService.emitToJob,
  emitToAdmins: socketService.emitToAdmins,
  notifyMotoristPaymentConfirmed,
});

app.use(Sentry.requestHandler());
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
app.use(globalLimiter);

app.use('/health', createHealthRouter({ checkConnection }));
app.use('/api/auth', authRouter);
app.use('/api/maps', auth, mapsRouter);
app.use('/api/uploads', auth, uploadsRouter);
app.use('/api', createPayoutCallbackRouter());
app.use('/api/payouts', auth, payoutsRouter);
app.use('/api', createJobRouter({
  auth,
  requireRole,
  Jobs,
  Services,
  emitToAdmins: socketService.emitToAdmins,
  emitToJob: socketService.emitToJob,
  assignBestProvider: dispatchService.assignBestProvider,
  notifyMotoristProviderArrived,
  notifyMotoristJobComplete,
  notifyProviderJobCancelled,
  notifyMotoristJobCancelled,
}));
app.use('/api', createProviderRouter({
  auth,
  requireRole,
  Users,
  Jobs,
  ProviderProfiles,
  emitToAdmins: socketService.emitToAdmins,
  io: socketService.io,
}));
app.use('/api', createAdminRouter({
  auth,
  requireRole,
  aiLimiter,
  anthropic,
  Analytics,
  Jobs,
  Users,
}));
app.use('/api', createAiRouter({ auth, aiLimiter, anthropic }));
app.use('/api', createPaymentRouter({ auth, requireRole, paymentService }));

app.use(notFoundHandler);
app.use(globalErrorHandler);

async function start() {
  let dbOk = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    dbOk = await checkConnection();
    if (dbOk) break;
    console.warn(`[STARTUP] DB attempt ${attempt}/5 failed - retrying in 3s...`);
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!dbOk) {
    console.error('[STARTUP] Cannot connect to database after 5 attempts. Check DATABASE_URL.');
    process.exit(1);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'server_started',
      port: PORT,
      env: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    }));
  });

  process.on('SIGTERM', () => {
    console.log(JSON.stringify({ level: 'INFO', event: 'sigterm_received' }));
    server.close(async () => {
      await closePool();
      console.log(JSON.stringify({ level: 'INFO', event: 'graceful_shutdown_complete' }));
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, server, start };
