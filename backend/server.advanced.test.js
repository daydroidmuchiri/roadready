/**
 * RoadReady backend advanced integration suite.
 *
 * Covers:
 * - dispatch retry behavior
 * - M-Pesa STK initiation and callback handling
 * - socket room isolation
 * - B2C payout lifecycle
 * - refresh token rotation
 */

require('dotenv').config();

process.env.SMS_DRY_RUN = 'true';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.MPESA_CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || 'test-consumer-key';
process.env.MPESA_CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || 'test-consumer-secret';
process.env.MPESA_PASSKEY = process.env.MPESA_PASSKEY || 'test-passkey';
process.env.MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || 'https://example.com/mpesa/callback';
process.env.MPESA_B2C_INITIATOR_NAME = process.env.MPESA_B2C_INITIATOR_NAME || 'testapi';
process.env.MPESA_B2C_SECURITY_CREDENTIAL = process.env.MPESA_B2C_SECURITY_CREDENTIAL || 'test-security-credential';
process.env.MPESA_B2C_RESULT_URL = process.env.MPESA_B2C_RESULT_URL || 'https://example.com/payouts/result';
process.env.MPESA_B2C_QUEUE_TIMEOUT_URL = process.env.MPESA_B2C_QUEUE_TIMEOUT_URL || 'https://example.com/payouts/timeout';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

jest.setTimeout(180000);

const mpesa = require('./mpesa');
const mpesaB2c = require('./mpesa_b2c');

jest.spyOn(mpesa, 'initiateSTKPush').mockResolvedValue({
  checkoutRequestId: 'CHK_TEST_12345',
  merchantRequestId: 'MR_TEST_12345',
  customerMessage: 'Simulated STK Push via Jest',
});

jest.spyOn(mpesaB2c, 'initiateB2CPayout').mockResolvedValue({
  conversationId: 'CONV_123',
  originatorConvId: 'ORG_CONV_123',
  responseDescription: 'Success',
});

jest.spyOn(mpesaB2c, 'isB2CConfigured').mockReturnValue(true);

const request = require('supertest');
const socketClient = require('socket.io-client');
const { app, server } = require('./server');
const { pool } = require('./db/pool');

const TEST_PHONES = {
  motorist1: '0799000010',
  motorist2: '0799000011',
  provider: '0799000012',
};

const tokens = {};
const userIds = {};

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryPoolQuery(text, params, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (attempt === attempts) throw err;
      await wait(attempt * 1000);
    }
  }
  return null;
}

async function ensureServerListening() {
  if (server.listening) return;

  await new Promise((resolve, reject) => {
    const handleError = (err) => {
      server.off('error', handleError);
      reject(err);
    };

    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });
}

async function closeServer() {
  if (!server.listening) return;
  await new Promise(resolve => server.close(resolve));
}

async function loginViaOtp(phone, name, role) {
  const sendRes = await request(app)
    .post('/api/auth/otp/send')
    .send({ phone, role });

  const code = sendRes.body.devCode;
  if (!code) {
    throw new Error(`OTP dry-run code missing for ${phone}`);
  }

  const verifyRes = await request(app)
    .post('/api/auth/otp/verify')
    .send({ phone, code, name, role });

  if (!verifyRes.body.token) {
    throw new Error(`OTP verify failed for ${phone}`);
  }

  return {
    token: verifyRes.body.token,
    id: verifyRes.body.user.id,
  };
}

async function cleanupAuthArtifacts() {
  const phones = Object.values(TEST_PHONES);
  const rateLimitKeys = [
    ...phones.map(phone => `phone:${phone}`),
    'ip:::ffff:127.0.0.1',
    'ip:::1',
    'ip:127.0.0.1',
  ];

  await retryPoolQuery('DELETE FROM otp_codes WHERE phone = ANY($1::text[])', [phones]);
  await retryPoolQuery('DELETE FROM otp_rate_limits WHERE key = ANY($1::text[])', [rateLimitKeys]);
}

async function cleanupTestUsersAndData() {
  const phones = Object.values(TEST_PHONES);

  await cleanupAuthArtifacts();
  await retryPoolQuery(
    'DELETE FROM job_status_history WHERE changed_by IN (SELECT id FROM users WHERE phone = ANY($1::text[]))',
    [phones],
  );
  await retryPoolQuery(
    'DELETE FROM job_status_history WHERE job_id IN (SELECT id FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])) OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])))',
    [phones],
  );
  await retryPoolQuery(
    'DELETE FROM payments WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])) OR job_id IN (SELECT id FROM jobs WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])))',
    [phones],
  );
  await retryPoolQuery(
    'DELETE FROM payouts WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))',
    [phones],
  );
  await retryPoolQuery(
    'DELETE FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])) OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))',
    [phones],
  );
  await retryPoolQuery('DELETE FROM users WHERE phone = ANY($1::text[])', [phones]);
}

async function cleanupProviderFixtures() {
  const motoristIds = [userIds.motorist1, userIds.motorist2];

  await retryPoolQuery(
    'DELETE FROM job_status_history WHERE job_id IN (SELECT id FROM jobs WHERE provider_id = $1 AND motorist_id = ANY($2::uuid[]))',
    [userIds.provider, motoristIds],
  );
  await retryPoolQuery(
    'DELETE FROM payments WHERE job_id IN (SELECT id FROM jobs WHERE provider_id = $1 AND motorist_id = ANY($2::uuid[]))',
    [userIds.provider, motoristIds],
  );
  await retryPoolQuery('DELETE FROM payouts WHERE provider_id = $1', [userIds.provider]);
  await retryPoolQuery(
    'DELETE FROM jobs WHERE provider_id = $1 AND motorist_id = ANY($2::uuid[])',
    [userIds.provider, motoristIds],
  );
  await retryPoolQuery("UPDATE users SET status = 'available' WHERE id = $1", [userIds.provider]);
}

async function seedProviderProfile() {
  await retryPoolQuery(
    `UPDATE provider_profiles
     SET
       onboard_status = 'approved',
       skills = $2::text[],
       id_verified = TRUE,
       background_check = TRUE,
       training_done = TRUE,
       mpesa_phone = $3,
       updated_at = NOW()
     WHERE user_id = $1`,
    [
      userIds.provider,
      ['jumpstart', 'tyre', 'fuel', 'lockout', 'tow', 'repair'],
      TEST_PHONES.provider,
    ],
  );
}

async function cleanupSuiteData() {
  const participantIds = [userIds.motorist1, userIds.motorist2, userIds.provider].filter(Boolean);
  if (!participantIds.length) return;

  await retryPoolQuery(
    'DELETE FROM job_status_history WHERE changed_by = ANY($1::uuid[]) OR job_id IN (SELECT id FROM jobs WHERE motorist_id = ANY($1::uuid[]) OR provider_id = ANY($1::uuid[]))',
    [participantIds],
  );
  await retryPoolQuery(
    'DELETE FROM payments WHERE motorist_id = ANY($1::uuid[]) OR job_id IN (SELECT id FROM jobs WHERE motorist_id = ANY($1::uuid[]) OR provider_id = ANY($1::uuid[]))',
    [participantIds],
  );
  await retryPoolQuery('DELETE FROM payouts WHERE provider_id = $1', [userIds.provider]);
  await retryPoolQuery(
    'DELETE FROM jobs WHERE motorist_id = ANY($1::uuid[]) OR provider_id = ANY($1::uuid[])',
    [participantIds],
  );
  await retryPoolQuery("UPDATE users SET status = 'offline' WHERE id = $1", [userIds.provider]);
}

beforeAll(async () => {
  await ensureServerListening();
  await cleanupTestUsersAndData();

  const motorist1 = await loginViaOtp(TEST_PHONES.motorist1, 'Advanced Motorist A', 'motorist');
  const motorist2 = await loginViaOtp(TEST_PHONES.motorist2, 'Advanced Motorist B', 'motorist');
  const provider = await loginViaOtp(TEST_PHONES.provider, 'Advanced Provider', 'provider');

  tokens.motorist1 = motorist1.token;
  tokens.motorist2 = motorist2.token;
  tokens.provider = provider.token;
  userIds.motorist1 = motorist1.id;
  userIds.motorist2 = motorist2.id;
  userIds.provider = provider.id;
  await seedProviderProfile();
});

afterAll(async () => {
  await cleanupTestUsersAndData();
  await closeServer();
  await pool.end();
});

describe('Dispatch Retry Logic', () => {
  beforeAll(async () => {
    await cleanupSuiteData();
    await seedProviderProfile();
  });

  it('retries dispatching if no provider is available and assigns once one becomes available', async () => {
    await request(app)
      .patch('/api/providers/status')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ status: 'offline' });

    await request(app)
      .patch('/api/providers/location')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ location: { lat: -1.2633, lng: 36.8035 } });

    const jobRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({
        serviceId: 'jumpstart',
        address: 'Test St',
        location: { lat: -1.2630, lng: 36.8030 },
      });

    expect(jobRes.status).toBe(201);
    const jobId = jobRes.body.id;
    expect(jobRes.body.status).toBe('searching');

    await wait(6500);

    let jobCheck = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${tokens.motorist1}`);

    expect(jobCheck.body.status).toBe('searching');
    expect(jobCheck.body.providerId).toBeNull();

    const statusRes = await request(app)
      .patch('/api/providers/status')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ status: 'available' });

    expect(statusRes.status).toBe(200);

    await wait(32000);

    jobCheck = await request(app)
      .get(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${tokens.motorist1}`);

    expect(['matched', 'en_route']).toContain(jobCheck.body.status);
    expect(jobCheck.body.providerId).toBe(userIds.provider);

    const meRes = await request(app)
      .get('/api/providers/me')
      .set('Authorization', `Bearer ${tokens.provider}`);

    expect(meRes.body.status).toBe('on_job');

    await request(app)
      .patch(`/api/jobs/${jobId}/status`)
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ status: 'cancelled', cancelReason: 'Advanced suite cleanup' });

    await retryPoolQuery("UPDATE users SET status = 'available' WHERE id = $1", [userIds.provider]);
  });
});

describe('M-Pesa STK callback and confirmation flow', () => {
  let paymentJobId;

  beforeAll(async () => {
    await cleanupSuiteData();
    await seedProviderProfile();

    const jobRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({
        serviceId: 'tyre',
        address: 'Testing',
        location: { lat: 0, lng: 0 },
      });

    paymentJobId = jobRes.body.id;

    await retryPoolQuery(
      "UPDATE jobs SET status = 'in_progress', provider_id = $1 WHERE id = $2",
      [userIds.provider, paymentJobId],
    );
  });

  it('initiates STK push', async () => {
    const res = await request(app)
      .post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ jobId: paymentJobId, phone: '0799111222' });

    expect(res.status).toBe(200);
    expect(res.body.checkoutRequestId).toBe('CHK_TEST_12345');

    const paymentCheck = await retryPoolQuery(
      'SELECT status FROM payments WHERE checkout_request_id = $1',
      ['CHK_TEST_12345'],
    );

    expect(paymentCheck.rows[0].status).toBe('processing');
  });

  it('handles failed callback gracefully without completing the job', async () => {
    const res = await request(app)
      .post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            ResultCode: 1032,
            ResultDesc: 'Cancelled by user',
            CheckoutRequestID: 'CHK_TEST_12345',
            MerchantRequestID: 'MR_TEST_12345',
          },
        },
      });

    expect(res.status).toBe(200);

    const paymentCheck = await retryPoolQuery(
      'SELECT status FROM payments WHERE checkout_request_id = $1',
      ['CHK_TEST_12345'],
    );
    const jobCheck = await retryPoolQuery(
      'SELECT status FROM jobs WHERE id = $1',
      [paymentJobId],
    );

    expect(paymentCheck.rows[0].status).toBe('failed');
    expect(jobCheck.rows[0].status).not.toBe('completed');
  });

  it('handles successful callback and marks payment and job as completed', async () => {
    mpesa.initiateSTKPush.mockResolvedValueOnce({
      checkoutRequestId: 'CHK_SUCCESS_999',
      merchantRequestId: 'MR_SUCCESS_999',
      customerMessage: 'Simulated STK Push via Jest',
    });

    const initiateRes = await request(app)
      .post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ jobId: paymentJobId, phone: '0799111222' });

    expect(initiateRes.status).toBe(200);
    expect(initiateRes.body.checkoutRequestId).toBe('CHK_SUCCESS_999');

    const callbackRes = await request(app)
      .post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            ResultCode: 0,
            ResultDesc: 'Success',
            CheckoutRequestID: 'CHK_SUCCESS_999',
            MerchantRequestID: 'MR_SUCCESS_999',
            CallbackMetadata: {
              Item: [
                { Name: 'MpesaReceiptNumber', Value: 'QK12345678' },
                { Name: 'Amount', Value: 500 },
              ],
            },
          },
        },
      });

    expect(callbackRes.status).toBe(200);

    const paymentCheck = await retryPoolQuery(
      'SELECT status FROM payments WHERE checkout_request_id = $1',
      ['CHK_SUCCESS_999'],
    );
    const jobCheck = await retryPoolQuery(
      'SELECT status FROM jobs WHERE id = $1',
      [paymentJobId],
    );

    expect(paymentCheck.rows[0].status).toBe('completed');
    expect(jobCheck.rows[0].status).toBe('completed');
  });

  it('safely handles duplicate successful callbacks idempotently', async () => {
    const res = await request(app)
      .post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            ResultCode: 0,
            ResultDesc: 'Success',
            CheckoutRequestID: 'CHK_SUCCESS_999',
            MerchantRequestID: 'MR_SUCCESS_999',
            CallbackMetadata: {
              Item: [
                { Name: 'MpesaReceiptNumber', Value: 'QK12345678' },
              ],
            },
          },
        },
      });

    expect(res.status).toBe(200);

    const paymentCheck = await retryPoolQuery(
      "SELECT count(*) FROM payments WHERE checkout_request_id = $1 AND status = 'completed'",
      ['CHK_SUCCESS_999'],
    );

    expect(Number(paymentCheck.rows[0].count)).toBe(1);
  });
});

describe('Socket Room Isolation', () => {
  let socketA;
  let socketB;
  let socketProvider;

  beforeAll(async () => {
    await cleanupSuiteData();
    await seedProviderProfile();

    const { port } = server.address();
    const url = `http://127.0.0.1:${port}`;

    await new Promise((resolve, reject) => {
      let connected = 0;
      const sockets = [];

      const onConnected = () => {
        connected += 1;
        if (connected === 3) resolve();
      };

      const onError = (err) => {
        sockets.forEach(socket => socket.disconnect());
        reject(err);
      };

      socketA = socketClient(url, {
        auth: { token: tokens.motorist1 },
        transports: ['websocket'],
      });
      socketB = socketClient(url, {
        auth: { token: tokens.motorist2 },
        transports: ['websocket'],
      });
      socketProvider = socketClient(url, {
        auth: { token: tokens.provider },
        transports: ['websocket'],
      });

      sockets.push(socketA, socketB, socketProvider);
      sockets.forEach(socket => {
        socket.once('connect', onConnected);
        socket.once('connect_error', onError);
      });
    });
  });

  afterAll(() => {
    socketA?.disconnect();
    socketB?.disconnect();
    socketProvider?.disconnect();
  });

  it('prevents events targeted at motorist A from reaching motorist B', async () => {
    const jobRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({
        serviceId: 'tyre',
        address: 'Isolated St',
        location: { lat: 1, lng: 1 },
      });

    expect(jobRes.status).toBe(201);
    const jobId = jobRes.body.id;

    let eventArrivedAtB = false;
    const onBJobUpdated = (payload) => {
      if (payload?.id === jobId) {
        eventArrivedAtB = true;
      }
    };

    socketB.on('job_updated', onBJobUpdated);

    const eventForA = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('motorist A did not receive job update')), 3000);
      socketA.once('job_updated', (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });

    const cancelRes = await request(app)
      .patch(`/api/jobs/${jobId}/status`)
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ status: 'cancelled', cancelReason: 'Isolation test' });

    expect(cancelRes.status).toBe(200);

    const payload = await eventForA;
    await wait(500);
    socketB.off('job_updated', onBJobUpdated);

    expect(payload.id).toBe(jobId);
    expect(payload.status).toBe('cancelled');
    expect(eventArrivedAtB).toBe(false);
  });
});

describe('B2C Payout Flow', () => {
  beforeAll(async () => {
    await cleanupSuiteData();
    await seedProviderProfile();
  });

  it('prevents payout request with no unpaid completed jobs', async () => {
    const res = await request(app)
      .post('/api/payouts/request')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ mpesaPhone: TEST_PHONES.provider });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/No pending earnings/i);
  });

  it('allows requesting payouts and correctly tracks Daraja callbacks', async () => {
    const jobResult = await retryPoolQuery(
      `INSERT INTO jobs (
         motorist_id, provider_id, service_id, status,
         price, commission, address, lat, lng,
         created_at, updated_at, completed_at
       )
       VALUES ($1, $2, 'tow', 'completed', 1000, 200, 'Payout Rd', 0, 0, NOW() - interval '1 hour', NOW(), NOW())
       RETURNING id, provider_earning`,
      [userIds.motorist2, userIds.provider],
    );

    const payoutJobId = jobResult.rows[0].id;
    expect(Number(jobResult.rows[0].provider_earning)).toBe(800);

    const payoutRes = await request(app)
      .post('/api/payouts/request')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ mpesaPhone: TEST_PHONES.provider });

    expect(payoutRes.status).toBe(201);
    expect(payoutRes.body.id).toBeTruthy();
    expect(payoutRes.body.status).toBe('processing');

    const payoutCheck = await retryPoolQuery(
      'SELECT id, status, amount, job_ids, b2c_conversation_id FROM payouts WHERE id = $1',
      [payoutRes.body.id],
    );

    expect(payoutCheck.rows[0].status).toBe('processing');
    expect(Number(payoutCheck.rows[0].amount)).toBe(800);
    expect(payoutCheck.rows[0].b2c_conversation_id).toBe('CONV_123');
    expect(payoutCheck.rows[0].job_ids).toContain(payoutJobId);

    const callbackRes = await request(app)
      .post('/api/payouts/mpesa/result')
      .send({
        Result: {
          ResultType: 0,
          ResultCode: 0,
          ResultDesc: 'Success',
          ConversationID: 'CONV_123',
          ResultParameters: {
            ResultParameter: [
              { Key: 'TransactionID', Value: 'TRX_888' },
              { Key: 'TransactionAmount', Value: 800 },
            ],
          },
        },
      });

    expect(callbackRes.status).toBe(200);

    const finalPayout = await retryPoolQuery(
      'SELECT status, mpesa_receipt FROM payouts WHERE id = $1',
      [payoutRes.body.id],
    );

    expect(finalPayout.rows[0].status).toBe('completed');
    expect(finalPayout.rows[0].mpesa_receipt).toBe('TRX_888');
  });
});

describe('Refresh Token Rotation', () => {
  let initialToken = '';
  let refreshedToken = '';

  beforeAll(async () => {
    await cleanupAuthArtifacts();
  });

  it('issues a fresh bearer token for a valid authenticated user', async () => {
    const sendRes = await request(app)
      .post('/api/auth/otp/send')
      .send({ phone: TEST_PHONES.motorist1, role: 'motorist' });

    const verifyRes = await request(app)
      .post('/api/auth/otp/verify')
      .send({
        phone: TEST_PHONES.motorist1,
        code: sendRes.body.devCode,
        role: 'motorist',
      });

    initialToken = verifyRes.body.token;
    expect(initialToken).toBeTruthy();

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${initialToken}`);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.token).toBeTruthy();
    refreshedToken = refreshRes.body.token;
    expect(typeof refreshedToken).toBe('string');
  });

  it('allows the original bearer token to remain valid', async () => {
    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${initialToken}`);

    expect(refreshRes.status).toBe(200);
  });

  it('rejects completely invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer not-a-valid-jwt.format.here');

    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token simulated with a wrong signature', async () => {
    expect(refreshedToken).toBeTruthy();

    const expiredToken = require('jsonwebtoken').sign(
      { id: userIds.motorist1 },
      'wrong-secret',
      { expiresIn: '-1h' },
    );

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
  });
});
