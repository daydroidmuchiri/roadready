/**
 * RoadReady Backend — Test Suite
 *
 * Run: npm test
 *
 * Requires a running PostgreSQL test database.
 * Set TEST_DATABASE_URL in your environment (or .env.test) before running:
 *
 *   TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/roadready_test npm test
 *
 * The suite uses the OTP flow (the current auth system).
 * OTP codes are returned in the response body when SMS_DRY_RUN=true (dev mode).
 *
 * Tests cover: validation, auth, RBAC, job lifecycle, payments, 404s, error format.
 */

// ─── Load test env BEFORE importing server ────────────────────────────────────
process.env.SMS_DRY_RUN   = 'true';   // OTP codes returned in response, not sent via SMS
process.env.NODE_ENV      = 'test';
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const request = require('supertest');
const { app, server } = require('./server');
const { pool }        = require('./db/pool');

// ─── Helpers ─────────────────────────────────────────────────────────────────

let motoristToken = '';
let providerToken = '';
let adminToken    = '';
let activeJobId   = '';

const MOTORIST_PHONE = '0799000001';
const PROVIDER_PHONE = '0799000002';
const ADMIN_PHONE    = '0799000003';

/**
 * Register (or log in) via OTP for a given phone number.
 * In dry-run mode the server returns devCode in the /otp/send response.
 * Returns a JWT for the authenticated user.
 */
async function loginViaOTP(phone, name, role) {
  // Step 1: send OTP
  const sendRes = await request(app)
    .post('/api/auth/otp/send')
    .send({ phone, role });

  // In dry-run mode the code is included in the response
  const code = sendRes.body.devCode;
  if (!code) throw new Error(`OTP dry-run code missing for ${phone} — is SMS_DRY_RUN=true?`);

  // Step 2: verify OTP (creates user on first call)
  const verifyRes = await request(app)
    .post('/api/auth/otp/verify')
    .send({ phone, code, name, role });

  if (!verifyRes.body.token) {
    throw new Error(`OTP verify failed for ${phone}: ${JSON.stringify(verifyRes.body)}`);
  }
  return verifyRes.body.token;
}

/**
 * Promote a user to admin role directly in the DB.
 * (There is no public admin-registration endpoint — intentionally.)
 */
async function promoteToAdmin(phone) {
  await pool.query(
    `UPDATE users SET role = 'admin' WHERE phone = $1`,
    [phone]
  );
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Clean up any leftover test accounts from previous runs (same FK order as afterAll).
  const testPhones = [MOTORIST_PHONE, PROVIDER_PHONE, ADMIN_PHONE, '0799000099',
    '0799000098', '0799000097', '0799000096', '+254799000095'];

  await pool.query(
    `DELETE FROM job_status_history
     WHERE changed_by IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );
  await pool.query(
    `DELETE FROM job_status_history
     WHERE job_id IN (
       SELECT id FROM jobs
       WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))
     )`,
    [testPhones]
  );
  await pool.query(
    `DELETE FROM payments
     WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );
  await pool.query(
    `DELETE FROM payouts
     WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );
  await pool.query(
    `DELETE FROM jobs
     WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))
        OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );
  await pool.query(
    `DELETE FROM users WHERE phone = ANY($1::text[])`,
    [testPhones]
  );

  motoristToken = await loginViaOTP(MOTORIST_PHONE, 'Test Driver',  'motorist');
  providerToken = await loginViaOTP(PROVIDER_PHONE, 'Test Mechanic','provider');
  adminToken    = await loginViaOTP(ADMIN_PHONE,    'Test Admin',   'motorist');

  // Upgrade the admin user's role directly in DB (can't do it via API)
  await promoteToAdmin(ADMIN_PHONE);
  // Re-issue token so it carries the 'admin' role
  adminToken = await loginViaOTP(ADMIN_PHONE, 'Test Admin', 'admin');
}, 30000);

afterAll(async () => {
  // Clean up test data in FK dependency order so we never hit a constraint violation.
  //
  // Dependency graph (child → parent):
  //   job_status_history → jobs, users (changed_by)
  //   payments           → jobs, users (motorist_id)
  //   payouts            → users (provider_id)
  //   jobs               → users (motorist_id, provider_id)
  //   provider_profiles  → users  [ON DELETE CASCADE — handled automatically]
  //   refresh_tokens     → users  [ON DELETE CASCADE — handled automatically]
  //
  // We must delete non-cascade children BEFORE deleting users.

  const testPhones = [MOTORIST_PHONE, PROVIDER_PHONE, ADMIN_PHONE, '0799000099',
    '0799000098', '0799000097', '0799000096', '+254799000095'];

  // 1. job_status_history rows whose changed_by is one of our test users
  await pool.query(
    `DELETE FROM job_status_history
     WHERE changed_by IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );

  // 2. job_status_history rows for jobs owned by our test users
  await pool.query(
    `DELETE FROM job_status_history
     WHERE job_id IN (
       SELECT id FROM jobs
       WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))
     )`,
    [testPhones]
  );

  // 3. payments
  await pool.query(
    `DELETE FROM payments
     WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );

  // 4. payouts (provider_id FK)
  await pool.query(
    `DELETE FROM payouts
     WHERE provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );

  // 5. jobs (motorist_id or provider_id)
  await pool.query(
    `DELETE FROM jobs
     WHERE motorist_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))
        OR provider_id IN (SELECT id FROM users WHERE phone = ANY($1::text[]))`,
    [testPhones]
  );

  // 6. users — provider_profiles and refresh_tokens cascade automatically
  await pool.query(
    `DELETE FROM users WHERE phone = ANY($1::text[])`,
    [testPhones]
  );

  server.close();
  await pool.end();
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
  });
});

// ─── Auth — OTP send ──────────────────────────────────────────────────────────

describe('POST /api/auth/otp/send', () => {
  it('rejects missing phone', async () => {
    const res = await request(app).post('/api/auth/otp/send').send({});
    expect(res.status).toBe(400);
  });

  it('rejects invalid Kenyan phone number', async () => {
    const res = await request(app).post('/api/auth/otp/send').send({ phone: '123456' });
    expect(res.status).toBe(400);
  });

  it('accepts 07XX format and returns devCode in dry-run', async () => {
    const res = await request(app).post('/api/auth/otp/send').send({ phone: '0711000099' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(res.body.devCode).toBeDefined();   // present because SMS_DRY_RUN=true
  });

  it('accepts +254 format', async () => {
    const res = await request(app).post('/api/auth/otp/send').send({ phone: '+254711000099' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
  });
});

// ─── Auth — OTP verify ────────────────────────────────────────────────────────

describe('POST /api/auth/otp/verify', () => {
  it('rejects wrong code', async () => {
    const res = await request(app).post('/api/auth/otp/verify')
      .send({ phone: MOTORIST_PHONE, code: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_ERROR');
  });

  it('rejects malformed code (not 6 digits)', async () => {
    const res = await request(app).post('/api/auth/otp/verify')
      .send({ phone: MOTORIST_PHONE, code: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.code).toBeDefined();
  });
});

// ─── Auth — token refresh ─────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('returns a new token for a valid existing token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${motoristToken}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('motorist');
  });

  it('rejects an invalid token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

// ─── Auth — /me ───────────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns the current user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${motoristToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('motorist');
  });

  it('rejects with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_ERROR');
  });

  it('rejects requests with invalid token', async () => {
    const res = await request(app).get('/api/jobs')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects requests with malformed auth header', async () => {
    const res = await request(app).get('/api/jobs')
      .set('Authorization', 'NotBearer sometoken');
    expect(res.status).toBe(401);
  });
});

// ─── Role-based access control ────────────────────────────────────────────────

describe('Role-based access control', () => {
  it('prevents motorist from listing all providers', async () => {
    const res = await request(app).get('/api/providers')
      .set('Authorization', `Bearer ${motoristToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents provider from creating a job', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ serviceId: 'jumpstart', address: 'Test St', location: { lat: -1.26, lng: 36.80 } });
    expect(res.status).toBe(403);
  });

  it('allows admin to list providers', async () => {
    const res = await request(app).get('/api/providers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ─── Services ─────────────────────────────────────────────────────────────────

describe('GET /api/services', () => {
  it('returns a list of services (no auth required)', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Seed data should include at least one service
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('price');
    }
  });
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

describe('POST /api/jobs', () => {
  it('rejects missing serviceId', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ address: 'Test St', location: { lat: -1.26, lng: 36.80 } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.serviceId).toBeDefined();
  });

  it('rejects missing address', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'jumpstart', location: { lat: -1.26, lng: 36.80 } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.address).toBeDefined();
  });

  it('rejects non-numeric coordinates', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'jumpstart', address: 'Test St', location: { lat: 'abc', lng: 36.80 } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.location).toBeDefined();
  });

  it('rejects out-of-range coordinates', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'jumpstart', address: 'Test St', location: { lat: 999, lng: 36.80 } });
    expect(res.status).toBe(400);
  });

  it('rejects unknown serviceId', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'teleportation', address: 'Test St', location: { lat: -1.26, lng: 36.80 } });
    expect(res.status).toBe(404);
  });

  it('creates a valid job', async () => {
    // First cancel any active jobs from previous test runs
    const jobs = await request(app).get('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`);
    const active = (jobs.body || []).filter(j => !['completed','cancelled'].includes(j.status));
    for (const j of active) {
      await request(app).patch(`/api/jobs/${j.id}/status`)
        .set('Authorization', `Bearer ${motoristToken}`)
        .send({ status: 'cancelled', cancelReason: 'test cleanup' });
    }

    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'jumpstart', address: 'Parklands Rd', location: { lat: -1.2633, lng: 36.8035 } });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe('searching');
    activeJobId = res.body.id;
  });

  it('rejects a second active job from the same motorist', async () => {
    const res = await request(app).post('/api/jobs')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ serviceId: 'jumpstart', address: 'Test St', location: { lat: -1.26, lng: 36.80 } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

// ─── Job status transitions ───────────────────────────────────────────────────

describe('PATCH /api/jobs/:id/status', () => {
  it('rejects invalid status value', async () => {
    const res = await request(app).patch(`/api/jobs/${activeJobId || 'J0000'}/status`)
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ status: 'teleporting' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.status).toBeDefined();
  });

  it('rejects invalid status transition (searching → completed)', async () => {
    if (!activeJobId) return;
    const res = await request(app).patch(`/api/jobs/${activeJobId}/status`)
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ status: 'completed' });
    expect(res.status).toBe(400);
  });

  it('allows motorist to cancel their own searching job', async () => {
    if (!activeJobId) return;
    const res = await request(app).patch(`/api/jobs/${activeJobId}/status`)
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ status: 'cancelled', cancelReason: 'Changed my mind' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });
});

// ─── M-Pesa Payment ──────────────────────────────────────────────────────────

describe('POST /api/payments/mpesa', () => {
  it('rejects invalid phone number format', async () => {
    const res = await request(app).post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ jobId: 'J0001', phone: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.phone).toBeDefined();
  });

  it('rejects non-existent job', async () => {
    const res = await request(app).post('/api/payments/mpesa')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ jobId: 'J9999', phone: '0712345678' });
    expect(res.status).toBe(404);
  });
});

// ─── Device token ─────────────────────────────────────────────────────────────

describe('PATCH /api/auth/device-token', () => {
  it('saves device token for motorist', async () => {
    const res = await request(app).patch('/api/auth/device-token')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({ deviceToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('saves device token for provider', async () => {
    const res = await request(app).patch('/api/auth/device-token')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ deviceToken: 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects missing token', async () => {
    const res = await request(app).patch('/api/auth/device-token')
      .set('Authorization', `Bearer ${motoristToken}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns JSON, not HTML, for unknown routes', async () => {
    const res = await request(app).delete('/api/services');
    expect(res.headers['content-type']).toMatch(/json/);
  });
});

// ─── Error response format ────────────────────────────────────────────────────

describe('Error response format', () => {
  it('always returns { error: { code, message } }', async () => {
    const res = await request(app).get('/api/jobs');  // no auth
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
  });

  it('never returns HTML error pages', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.headers['content-type']).toMatch(/json/);
    expect(typeof res.body).toBe('object');
  });

  it('never exposes stack traces in production mode', async () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const res = await request(app).get('/api/nonexistent');
    expect(res.body.error.stack).toBeUndefined();
    process.env.NODE_ENV = origEnv;
  });
});
