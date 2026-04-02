/**
 * RoadReady Backend — Advanced Test Suite
 * Covers logic for Dispatch Retry, M-Pesa STK & B2C, Socket Isolation, and Refresh Token Rotation.
 */

// ─── Setup Environment BEFORE importing server ────────────────────────────────
require('dotenv').config(); // Load variables first
process.env.SMS_DRY_RUN = 'true';
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random port to avoid EADDRINUSE with other test suites

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const request = require('supertest');
const { app, server } = require('./server');
const { pool } = require('./db/pool');
const io = require('socket.io-client');
const mpesa = require('./mpesa');
const mpesaB2c = require('./mpesa_b2c');

// Mocks for Daraja
jest.spyOn(mpesa, 'initiateSTKPush').mockResolvedValue({
  checkoutRequestId: 'CHK_TEST_12345',
  merchantRequestId: 'MR_TEST_12345',
  customerMessage: 'Simulated STK Push via Jest'
});

jest.spyOn(mpesaB2c, 'initiateB2CPayout').mockResolvedValue({
  conversationId: 'CONV_123',
  originatorConvId: 'ORG_CONV_123',
  responseDescription: 'Success'
});

jest.spyOn(mpesaB2c, 'isB2CConfigured').mockReturnValue(true);

// ─── Test Users & Globals ───────────────────────────────────────────────────
const TEST_PHONES = {
  motorist1: '0799000010',
  motorist2: '0799000011',
  provider:  '0799000012'
};

let tokens = {};
let userIds = {};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function loginViaOTP(phone, name, role) {
  const sendRes = await request(app).post('/api/auth/otp/send').send({ phone, role });
  const code = sendRes.body.devCode;
  if (!code) throw new Error(`OTP dry-run code missing for ${phone}`);

  const verifyRes = await request(app).post('/api/auth/otp/verify').send({ phone, code, name, role });
  if (!verifyRes.body.token) throw new Error(`OTP verify failed for ${phone}`);
  
  return { token: verifyRes.body.token, id: verifyRes.body.user.id };
}

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  const phonesArray = Object.values(TEST_PHONES);

  // Clean data using exact FK dependency order
  await pool.query(`DELETE FROM job_status_history WHERE changed_by IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM job_status_history WHERE job_id IN (SELECT id FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])))`, [phonesArray]);
  await pool.query(`DELETE FROM payments WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM payouts WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])) OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM users WHERE phone = ANY($1::text[])`, [phonesArray]);

  const m1 = await loginViaOTP(TEST_PHONES.motorist1, 'Advanced Motorist A', 'motorist');
  const m2 = await loginViaOTP(TEST_PHONES.motorist2, 'Advanced Motorist B', 'motorist');
  const p  = await loginViaOTP(TEST_PHONES.provider,  'Advanced Provider',   'provider');

  tokens.motorist1 = m1.token; userIds.motorist1 = m1.id;
  tokens.motorist2 = m2.token; userIds.motorist2 = m2.id;
  tokens.provider  = p.token;  userIds.provider  = p.id;
}, 30000);

afterAll(async () => {
  const phonesArray = Object.values(TEST_PHONES);
  await pool.query(`DELETE FROM job_status_history WHERE changed_by IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM job_status_history WHERE job_id IN (SELECT id FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])))`, [phonesArray]);
  await pool.query(`DELETE FROM payments WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM payouts WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM jobs WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[])) OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`, [phonesArray]);
  await pool.query(`DELETE FROM users WHERE phone = ANY($1::text[])`, [phonesArray]);

  server.close();
  await pool.end();
});

// ─── TEST AREA 1: Dispatch Retry Logic ──────────────────────────────────────

describe('Dispatch Retry Logic', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries dispatching if no provider is available and properly assigns when one becomes available', async () => {
    // 1. Ensure provider is offline initially and at specific location
    await request(app).patch('/api/providers/status')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ status: 'offline' });
    
    await request(app).patch('/api/providers/location')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ location: { lat: -1.2633, lng: 36.8035 } });

    // 2. Motorist creates a job
    const jobRes = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ serviceId: 'jumpstart', address: 'Test St', location: { lat: -1.2630, lng: 36.8030 } });
    
    expect(jobRes.status).toBe(201);
    const jobId = jobRes.body.id;
    expect(jobRes.body.status).toBe('searching');

    // Fast-forward initial auto-dispatch timeout (5 seconds)
    jest.advanceTimersByTime(6000); 
    // Advance async tasks safely
    await Promise.resolve();

    // Verify still searching because no one is available
    let jobCheck = await request(app).get(`/api/jobs/${jobId}`).set('Authorization', `Bearer ${tokens.motorist1}`);
    expect(jobCheck.body.status).toBe('searching');
    expect(jobCheck.body.providerId).toBeNull();

    // 3. Provider becomes available
    const statusRes = await request(app).patch('/api/providers/status')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ status: 'available' });
    expect(statusRes.status).toBe(200);

    // 4. Fast-forward past the dispatch retry loop (30 seconds)
    jest.advanceTimersByTime(31000);
    // Allow promises in the setTimeout to execute
    for(let i=0; i<10; i++) { await Promise.resolve(); }

    // 5. Job should now be matched
    jobCheck = await request(app).get(`/api/jobs/${jobId}`).set('Authorization', `Bearer ${tokens.motorist1}`);
    expect(['matched', 'en_route']).toContain(jobCheck.body.status);
    expect(jobCheck.body.providerId).toBe(userIds.provider);

    // 6. Verify provider's status is 'on_job'
    const meRes = await request(app).get('/api/providers/me').set('Authorization', `Bearer ${tokens.provider}`);
    expect(meRes.body.status).toBe('on_job');

    // Clean up: complete the job so provider becomes available again, or cancel
    await pool.query(`UPDATE jobs SET status = 'cancelled' WHERE id = $1`, [jobId]);
    await pool.query(`UPDATE users SET status = 'available' WHERE id = $1`, [userIds.provider]);
  });
});

// ─── TEST AREA 2: M-Pesa STK Push -> Callback Flow ──────────────────────────

describe('M-Pesa STK callback and confirmation flow', () => {
  let paymentJobId;

  beforeAll(async () => {
    const jobRes = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ serviceId: 'tyre', address: 'Testing', location: { lat: 0, lng: 0 } });
    paymentJobId = jobRes.body.id;
    
    // Fast-transition this job to 'completed' so it can be paid
    await pool.query(`UPDATE jobs SET status = 'completed', provider_id = $1 WHERE id = $2`, [userIds.provider, paymentJobId]);
  });

  it('initiates STK push', async () => {
    // temporarily force config to mock condition
    process.env.MPESA_CONSUMER_KEY = 'test';
    process.env.MPESA_PASSKEY = 'test';
    process.env.MPESA_CALLBACK_URL = 'http://test';

    const res = await request(app).post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ jobId: paymentJobId, phone: '0799111222' });
    
    expect(res.status).toBe(200);
    expect(res.body.checkoutRequestId).toBe('CHK_TEST_12345');
  });

  it('handles failed callback gracefully without completing job payment', async () => {
    const res = await request(app).post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            ResultCode: 1032,
            ResultDesc: 'Cancelled by user',
            CheckoutRequestID: 'CHK_TEST_12345',
            MerchantRequestID: 'MR_TEST_12345'
          }
        }
      });
    
    expect(res.status).toBe(200);
    
    const dbCheck = await pool.query(`SELECT status FROM payments WHERE checkout_request_id = 'CHK_TEST_12345'`);
    expect(dbCheck.rows[0].status).toBe('failed');
  });

  it('handles successful callback and marks payment and job as completed', async () => {
    // First we generate a new checkout request to avoid conflicting with the failed one above
    jest.spyOn(mpesa, 'initiateSTKPush').mockResolvedValueOnce({
      checkoutRequestId: 'CHK_SUCCESS_999',
      merchantRequestId: 'MR_SUCCESS_999'
    });

    await request(app).post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ jobId: paymentJobId, phone: '0799111222' });

    const res = await request(app).post('/api/payments/mpesa/callback')
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
                { Name: 'Amount', Value: 500 }
              ]
            }
          }
        }
      });
    
    expect(res.status).toBe(200);

    const dbCheck = await pool.query(`SELECT status FROM payments WHERE checkout_request_id = 'CHK_SUCCESS_999'`);
    expect(dbCheck.rows[0].status).toBe('completed');
  });

  it('safely handles duplicate successful callbacks idempotently', async () => {
    const res = await request(app).post('/api/payments/mpesa/callback')
      .send({
        Body: {
          stkCallback: {
            ResultCode: 0,
            ResultDesc: 'Success',
            CheckoutRequestID: 'CHK_SUCCESS_999',
            MerchantRequestID: 'MR_SUCCESS_999',
            CallbackMetadata: {
              Item: [
                { Name: 'MpesaReceiptNumber', Value: 'QK12345678' }
              ]
            }
          }
        }
      });
    
    expect(res.status).toBe(200);
    const dbCheck = await pool.query(`SELECT count(*) FROM payments WHERE checkout_request_id = 'CHK_SUCCESS_999' AND status = 'completed'`);
    expect(parseInt(dbCheck.rows[0].count)).toBe(1); // Still exactly 1 record
  });
});

// ─── TEST AREA 3: Socket Room Isolation ─────────────────────────────────────

describe('Socket Room Isolation', () => {
  let socketA, socketB, socketProv;

  beforeAll((done) => {
    const port = server.address().port;
    const url = `http://localhost:${port}`;
    let connected = 0;
    const connectHandler = () => { connected++; if(connected === 3) done(); };

    socketA = io(url, { auth: { token: tokens.motorist1 } });
    socketB = io(url, { auth: { token: tokens.motorist2 } });
    socketProv = io(url, { auth: { token: tokens.provider } });

    socketA.on('connect', connectHandler);
    socketB.on('connect', connectHandler);
    socketProv.on('connect', connectHandler);
  });

  afterAll(() => {
    socketA?.disconnect();
    socketB?.disconnect();
    socketProv?.disconnect();
  });

  it('prevents events targeted at motorist A from reaching motorist B', async () => {
    const eventPromiseA = new Promise(resolve => socketA.once('test_job_matched', resolve));
    let eventArrivedAtB = false;
    socketB.once('test_job_matched', () => { eventArrivedAtB = true; });

    // Manually push an event through the server backend targeting ONLY motorist 1
    // (This requires us to just emit directly from the server to motorist1's room)
    const serverIo = require('./server').app.get('io') || io.server; 
    // Wait, the io instance is not exported from server.js? 
    // Actually `emitToUser` isn't exported, but we know the room format is `user:\${userId}`
    // Let's create a temporary job that belongs to motorist A, and status updates it.
    
    const jobRes = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ serviceId: 'tyre', address: 'Isolated St', location: { lat: 1, lng: 1 } });
    const m1JobId = jobRes.body.id;

    const bPromise = new Promise(resolve => {
      socketB.once('job_updated', () => { eventArrivedAtB = true; resolve(); });
      setTimeout(resolve, 500); // Check after 500ms
    });

    // Motorist acts on THEIR job: cancel it. This emits 'job_updated' using emitToJob internally
    await request(app).patch(`/api/jobs/${m1JobId}/status`)
      .set('Authorization', `Bearer ${tokens.motorist1}`)
      .send({ status: 'cancelled' });

    await bPromise;
    expect(eventArrivedAtB).toBe(false);
  });
});

// ─── TEST AREA 4: B2C Payout Flow ───────────────────────────────────────────

describe('B2C Payout Flow', () => {
  it('prevents payout request with no unpaid completed jobs', async () => {
    const res = await request(app).post('/api/payouts/request')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ mpesaPhone: TEST_PHONES.provider });
    expect(res.status).toBe(400); // Needs completed jobs
  });

  it('allows requesting payouts and correctly tracks Daraja callbacks', async () => {
    // 1. Seed a completed job with payment
    const tempMotoristId = userIds.motorist2;
    const providerId = userIds.provider;
    
    const jobQuery = await pool.query(`
      INSERT INTO jobs (motorist_id, provider_id, service_id, status, price, commission, provider_earning, lat, lng, address, created_at, updated_at)
      VALUES ($1, $2, 'towing', 'completed', 1000, 200, 800, 0, 0, 'Payout Rd', NOW() - interval '1 hour', NOW())
      RETURNING id;
    `, [tempMotoristId, providerId]);
    
    const payoutJobId = jobQuery.rows[0].id;

    await pool.query(`
      INSERT INTO payments (job_id, motorist_id, amount, mpesa_phone, checkout_request_id, status, completed_at)
      VALUES ($1, $2, 1000, $3, 'PAYOUT_SEED_123', 'completed', NOW())
    `, [payoutJobId, tempMotoristId, '0799222333']);

    // 2. Request Payout
    const payoutRes = await request(app).post('/api/payouts/request')
      .set('Authorization', `Bearer ${tokens.provider}`)
      .send({ mpesaPhone: TEST_PHONES.provider });
    
    expect(payoutRes.status).toBe(201);
    const payoutId = payoutRes.body.payoutId; // payout creation returns ID or similar, wait let's check
    
    // We get "Payout initiated"
    const dbCheck = await pool.query(`SELECT id, status FROM payouts WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 1`, [providerId]);
    expect(dbCheck.rows[0].status).toBe('pending');
    const realPayoutId = dbCheck.rows[0].id;

    // 3. Callback resolves the payout
    const b2cCallbackRes = await request(app).post('/api/payouts/mpesa/result')
      .send({
        Result: {
          ResultType: 0,
          ResultCode: 0,
          ResultDesc: 'Success',
          ConversationID: 'CONV_123',
          ResultParameters: {
            ResultParameter: [
              { Key: 'TransactionID', Value: 'TRX_888' },
              { Key: 'TransactionAmount', Value: 800 }
            ]
          }
        }
      });
    
    expect(b2cCallbackRes.status).toBe(200);

    // 4. Verify Payout and Job Status
    const payoutFinal = await pool.query(`SELECT status FROM payouts WHERE conversation_id = 'CONV_123'`);
    expect(payoutFinal.rows[0].status).toBe('completed');
    
    const jobFinal = await pool.query(`SELECT payout_id FROM jobs WHERE id = $1`, [payoutJobId]);
    expect(jobFinal.rows[0].payout_id).toEqual(realPayoutId);
  });
});

// ─── TEST AREA 5: Refresh Token Rotation ────────────────────────────────────

describe('Refresh Token Rotation', () => {
  let initialRefresh = '';
  let secondRefresh = '';

  it('obtains new access and refresh tokens, invalidating the old one', async () => {
    // 1. We need a raw refresh token. Log in again directly to extract it.
    const sendRes = await request(app).post('/api/auth/otp/send').send({ phone: TEST_PHONES.motorist1, role: 'motorist' });
    const code = sendRes.body.devCode;
    const verifyRes = await request(app).post('/api/auth/otp/verify').send({ phone: TEST_PHONES.motorist1, code, role: 'motorist' });
    
    initialRefresh = verifyRes.body.refreshToken;
    expect(initialRefresh).toBeTruthy();

    // 2. Refresh it
    const refresh1 = await request(app).post('/api/auth/refresh')
      .send({ refreshToken: initialRefresh });
    
    expect(refresh1.status).toBe(200);
    expect(refresh1.body.token).toBeTruthy();
    expect(refresh1.body.refreshToken).toBeTruthy();
    secondRefresh = refresh1.body.refreshToken;
    
    // Test that rotation changed it
    expect(secondRefresh).not.toBe(initialRefresh);
  });

  it('rejects attempt to use the old rotated refresh token', async () => {
    const refreshInvalid = await request(app).post('/api/auth/refresh')
      .send({ refreshToken: initialRefresh });
    expect(refreshInvalid.status).toBe(401);
  });

  it('rejects completely invalid refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-valid-jwt.format.here' });
    expect(res.status).toBe(401);
  });

  it('rejects an expired refresh token (simulate behavior via invalid signature)', async () => {
    // A structurally valid JWT but signed with a wrong secret will fail 
    // precisely the same way as being unrecognised or expired
    const expiredToken = require('jsonwebtoken').sign({ id: userIds.motorist1 }, 'wrong-secret', { expiresIn: '-1h' });
    const res = await request(app).post('/api/auth/refresh')
      .send({ refreshToken: expiredToken });
    expect(res.status).toBe(401);
  });
});
