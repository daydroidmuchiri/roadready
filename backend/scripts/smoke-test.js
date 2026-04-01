/**
 * RoadReady Manual Smoke Test
 *
 * ⚠️  WARNING: This script targets the PRODUCTION backend.
 *     Run manually only. Never run in CI or automated pipelines.
 *
 * Usage: node backend/scripts/smoke-test.js
 */

const https = require('https');

function request(path, payload, token = null) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload || {});
    const options = {
      hostname: 'roadready-production-a741.up.railway.app',
      port: 443,
      path,
      method: payload ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(data);
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, data: body }));
    });
    req.on('error', reject);
    if (payload) req.write(data);
    req.end();
  });
}

(async () => {
  try {
    console.log('--- 1. Send OTP ---');
    const sendRes = await request('/api/auth/otp/send', {
      phone: '0711223344',
      role: 'motorist',
    });
    console.log(sendRes.status, sendRes.data);
    const sendData = JSON.parse(sendRes.data);
    const code = sendData.devCode;
    console.log('Received devCode:', code ?? 'NOT RETURNED (expected in dev only)');

    console.log('--- 2. Verify OTP ---');
    const authRes = await request('/api/auth/otp/verify', {
      phone: '0711223344',
      code: String(code),
      role: 'motorist',
    });
    console.log(authRes.status, authRes.data);
    const authData = JSON.parse(authRes.data);
    const token = authData.accessToken ?? null;
    console.log('Received token:', token ? 'YES' : 'NO');

    console.log('--- 3. /api/auth/me ---');
    const meRes = await request('/api/auth/me', null, token);
    console.log(meRes.status, meRes.data);
  } catch (err) {
    console.error('Error:', err);
  }
})();