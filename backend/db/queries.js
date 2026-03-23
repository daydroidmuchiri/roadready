/**
 * RoadReady — Database Query Layer
 *
 * All database access goes through named functions here.
 * server.js calls these functions — it never writes raw SQL.
 *
 * Conventions:
 *   - All functions are async and throw on error (pool.js logs & rethrows)
 *   - Row results are returned as plain JS objects (camelCase keys via rowMapper)
 *   - $1, $2... parameterised queries everywhere — no string interpolation
 */

const { query, transaction } = require('./pool');

// ─── Row mapper ───────────────────────────────────────────────
// Converts snake_case DB column names to camelCase JS keys.
// e.g. { motorist_id: 'x', created_at: ... } → { motoristId: 'x', createdAt: ... }

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function mapRow(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [toCamel(k), v])
  );
}

function mapRows(rows) {
  return rows.map(mapRow);
}

// ─── Users ────────────────────────────────────────────────────

const Users = {

  async findByPhone(phone) {
    const { rows } = await query(
      'SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL',
      [phone]
    );
    return mapRow(rows[0]);
  },

  async findById(id) {
    const { rows } = await query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return mapRow(rows[0]);
  },

  async create({ name, phone, passwordHash, role }) {
    const { rows } = await query(
      `INSERT INTO users (name, phone, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, phone, role, status, created_at`,
      [name, phone, passwordHash, role, 'offline']
    );
    return mapRow(rows[0]);
  },

  async updateLocation(userId, lat, lng) {
    await query(
      `UPDATE users
       SET lat = $1, lng = $2, location_updated_at = NOW()
       WHERE id = $3`,
      [lat, lng, userId]
    );
  },

  async updateStatus(userId, status) {
    const { rows } = await query(
      `UPDATE users SET status = $1 WHERE id = $2
       RETURNING id, status`,
      [status, userId]
    );
    return mapRow(rows[0]);
  },

  async listAdmins() {
    const { rows } = await query(
      'SELECT id, name, device_token FROM users WHERE role = $1 AND deleted_at IS NULL',
      ['admin']
    );
    return mapRows(rows);
  },

  async findByDeviceToken(deviceToken) {
    const { rows } = await query(
      'SELECT id FROM users WHERE device_token = $1 LIMIT 1',
      [deviceToken]
    );
    return mapRow(rows[0]);
  },

  async markVerified(userId) {
    await query(
      'UPDATE users SET is_verified = TRUE WHERE id = $1',
      [userId]
    );
  },

  async updateDeviceToken(userId, deviceToken) {
    await query(
      'UPDATE users SET device_token = $1 WHERE id = $2',
      [deviceToken, userId]
    );
  },

  // Returns all providers with their profile data, ordered by rating
  async listProviders() {
    const { rows } = await query(`
      SELECT
        u.id, u.name, u.phone, u.rating, u.rating_count,
        u.status, u.lat, u.lng, u.is_verified,
        pp.skills, pp.onboard_status, pp.total_jobs, pp.total_earnings,
        pp.mpesa_phone
      FROM users u
      LEFT JOIN provider_profiles pp ON u.id = pp.user_id
      WHERE u.role = 'provider' AND u.deleted_at IS NULL
      ORDER BY u.rating DESC, pp.total_jobs DESC
    `);
    return mapRows(rows);
  },

  // Find available providers who have a required skill, within km radius
  async findAvailableProvidersNearby(serviceId, lat, lng, radiusKm = 20) {
    // Haversine distance using pure SQL — works without PostGIS
    const { rows } = await query(`
      SELECT
        u.id, u.name, u.rating, u.lat, u.lng,
        pp.skills,
        (
          6371 * acos(
            cos(radians($1)) * cos(radians(u.lat)) *
            cos(radians(u.lng) - radians($2)) +
            sin(radians($1)) * sin(radians(u.lat))
          )
        ) AS distance_km
      FROM users u
      JOIN provider_profiles pp ON u.id = pp.user_id
      WHERE
        u.role    = 'provider'
        AND u.status  = 'available'
        AND u.deleted_at IS NULL
        AND pp.onboard_status = 'approved'
        AND $3 = ANY(pp.skills)
        AND u.lat IS NOT NULL
        AND u.lng IS NOT NULL
        AND (
          6371 * acos(
            cos(radians($1)) * cos(radians(u.lat)) *
            cos(radians(u.lng) - radians($2)) +
            sin(radians($1)) * sin(radians(u.lat))
          )
        ) <= $4
      ORDER BY distance_km ASC, u.rating DESC
      LIMIT 10
    `, [lat, lng, serviceId, radiusKm]);
    return mapRows(rows);
  },

};

// ─── Services ─────────────────────────────────────────────────

const Services = {

  async list() {
    const { rows } = await query(
      'SELECT * FROM services WHERE is_active = TRUE ORDER BY price ASC'
    );
    return mapRows(rows);
  },

  async findById(id) {
    const { rows } = await query(
      'SELECT * FROM services WHERE id = $1 AND is_active = TRUE',
      [id]
    );
    return mapRow(rows[0]);
  },

};

// ─── Jobs ─────────────────────────────────────────────────────

const Jobs = {

  async create({ motoristId, serviceId, price, commission, address, lat, lng }) {
    const { rows } = await query(
      `INSERT INTO jobs (motorist_id, service_id, price, commission, address, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [motoristId, serviceId, price, commission, address, lat, lng]
    );
    return mapRow(rows[0]);
  },

  async findById(id) {
    const { rows } = await query(
      'SELECT * FROM job_details WHERE id = $1',
      [id]
    );
    return mapRow(rows[0]);
  },

  async findActiveByMotorist(motoristId) {
    const { rows } = await query(
      `SELECT * FROM jobs
       WHERE motorist_id = $1 AND status NOT IN ('completed', 'cancelled')`,
      [motoristId]
    );
    return mapRows(rows);
  },

  async listByMotorist(motoristId) {
    const { rows } = await query(
      `SELECT j.*, s.name AS service_name, s.emoji AS service_emoji
       FROM jobs j JOIN services s ON j.service_id = s.id
       WHERE j.motorist_id = $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [motoristId]
    );
    return mapRows(rows);
  },

  async listByProvider(providerId) {
    const { rows } = await query(
      `SELECT j.*, s.name AS service_name, s.emoji AS service_emoji
       FROM jobs j JOIN services s ON j.service_id = s.id
       WHERE j.provider_id = $1
       ORDER BY j.created_at DESC
       LIMIT 50`,
      [providerId]
    );
    return mapRows(rows);
  },

  async listAll({ limit = 100, offset = 0, status } = {}) {
    const conditions = status ? `WHERE j.status = $3` : '';
    const params = status ? [limit, offset, status] : [limit, offset];
    const { rows } = await query(
      `SELECT * FROM job_details ${conditions}
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    return mapRows(rows);
  },

  // Assign a provider and transition to 'matched'
  async assignProvider(jobId, providerId) {
    return transaction(async (client) => {
      // Lock both rows to prevent race conditions
      const { rows: jobRows } = await client.query(
        `SELECT id, status FROM jobs WHERE id = $1 FOR UPDATE`,
        [jobId]
      );
      if (!jobRows[0] || jobRows[0].status !== 'searching')
        return null;   // already matched or cancelled

      await client.query(
        `UPDATE users SET status = 'on_job' WHERE id = $1`,
        [providerId]
      );

      const { rows } = await client.query(
        `UPDATE jobs
         SET provider_id = $1, status = 'matched', matched_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [providerId, jobId]
      );
      return mapRow(rows[0]);
    });
  },

  // Status transition with timestamp tracking
  async updateStatus(jobId, newStatus, extra = {}) {
    const tsColumn = {
      en_route:    'en_route_at',
      on_site:     'on_site_at',
      in_progress: 'started_at',
      completed:   'completed_at',
      cancelled:   'cancelled_at',
    }[newStatus];

    const sets = ['status = $2', 'updated_at = NOW()'];
    const params = [jobId, newStatus];

    if (tsColumn) {
      sets.push(`${tsColumn} = NOW()`);
    }
    if (extra.cancelReason) {
      sets.push(`cancel_reason = $${params.length + 1}`);
      params.push(extra.cancelReason);
    }

    const { rows } = await query(
      `UPDATE jobs SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    return mapRow(rows[0]);
  },

  async findActiveJobByProvider(providerId) {
    const { rows } = await query(
      `SELECT id, motorist_id FROM jobs
       WHERE provider_id = $1
         AND status NOT IN ('completed','cancelled')
       LIMIT 1`,
      [providerId]
    );
    return mapRow(rows[0]);
  },

  async submitRating(jobId, raterRole, rating) {
    const column = raterRole === 'motorist' ? 'motorist_rating' : 'provider_rating';
    const { rows } = await query(
      `UPDATE jobs SET ${column} = $1 WHERE id = $2 RETURNING *`,
      [rating, jobId]
    );
    return mapRow(rows[0]);
  },

};

// ─── Payments ─────────────────────────────────────────────────

const Payments = {

  async create({ jobId, motoristId, amount, mpesaPhone }) {
    const { rows } = await query(
      `INSERT INTO payments (job_id, motorist_id, amount, mpesa_phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [jobId, motoristId, amount, mpesaPhone]
    );
    return mapRow(rows[0]);
  },

  async updateCheckoutRequestId(paymentId, checkoutRequestId, merchantRequestId) {
    const { rows } = await query(
      `UPDATE payments
       SET checkout_request_id = $1, merchant_request_id = $2, status = 'processing'
       WHERE id = $3
       RETURNING *`,
      [checkoutRequestId, merchantRequestId, paymentId]
    );
    return mapRow(rows[0]);
  },

  async confirmByCheckoutId(checkoutRequestId, mpesaReceipt) {
    return transaction(async (client) => {
      // Idempotent: only update if still in 'processing' state
      // Prevents duplicate Safaricom callbacks from double-confirming
      const { rows: pmtRows } = await client.query(
        `UPDATE payments
         SET status = 'completed', mpesa_receipt = $1, confirmed_at = NOW()
         WHERE checkout_request_id = $2
           AND status = 'processing'
         RETURNING *`,
        [mpesaReceipt, checkoutRequestId]
      );
      if (!pmtRows[0]) return null;

      // Also mark the job as completed
      await client.query(
        `UPDATE jobs SET status = 'completed', completed_at = NOW()
         WHERE id = $1`,
        [pmtRows[0].job_id]
      );

      return mapRow(pmtRows[0]);
    });
  },

  async failByCheckoutId(checkoutRequestId, reason) {
    const { rows } = await query(
      `UPDATE payments
       SET status = 'failed', failure_reason = $1, failed_at = NOW()
       WHERE checkout_request_id = $2
       RETURNING *`,
      [reason, checkoutRequestId]
    );
    return mapRow(rows[0]);
  },

  async findByJobId(jobId) {
    const { rows } = await query(
      'SELECT * FROM payments WHERE job_id = $1 ORDER BY initiated_at DESC LIMIT 1',
      [jobId]
    );
    return mapRow(rows[0]);
  },

};

// ─── Analytics ────────────────────────────────────────────────

const Analytics = {

  async dashboard() {
    const [todayResult, providerResult, weekResult] = await Promise.all([
      query('SELECT * FROM analytics_today'),
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'available') AS available,
          COUNT(*) FILTER (WHERE status = 'on_job')    AS on_job,
          COUNT(*) FILTER (WHERE status = 'offline')   AS offline
        FROM users WHERE role = 'provider' AND deleted_at IS NULL
      `),
      query(`
        SELECT
          TO_CHAR(created_at, 'Dy') AS day,
          COALESCE(SUM(price) FILTER (WHERE status = 'completed'), 0) AS revenue,
          COUNT(*) AS total_jobs
        FROM jobs
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY TO_CHAR(created_at, 'Dy'), DATE_TRUNC('day', created_at)
        ORDER BY DATE_TRUNC('day', created_at)
      `),
    ]);

    const today    = mapRow(todayResult.rows[0]) || {};
    const providers = mapRow(providerResult.rows[0]) || {};

    return {
      totalJobsToday:     parseInt(today.totalJobs)     || 0,
      completedToday:     parseInt(today.completedJobs)  || 0,
      activeJobs:         parseInt(today.activeJobs)     || 0,
      revenueToday:       parseInt(today.totalRevenue)   || 0,
      commissionToday:    parseInt(today.totalCommission) || 0,
      avgResponseMinutes: parseFloat(today.avgResponseMinutes) || 0,
      providersAvailable: parseInt(providers.available)  || 0,
      providersOnJob:     parseInt(providers.onJob)       || 0,
      weeklyRevenue:      mapRows(weekResult.rows),
    };
  },

};

// ─── Provider Profiles ────────────────────────────────────────

const ProviderProfiles = {

  async findByUserId(userId) {
    const { rows } = await query(
      'SELECT * FROM provider_profiles WHERE user_id = $1',
      [userId]
    );
    return mapRow(rows[0]);
  },

  async todayEarnings(userId) {
    const { rows } = await query(`
      SELECT
        COALESCE(SUM(provider_earning), 0) AS today_earnings,
        COUNT(*) FILTER (WHERE status = 'completed') AS today_jobs
      FROM jobs
      WHERE provider_id = $1
        AND created_at >= CURRENT_DATE
    `, [userId]);
    return mapRow(rows[0]);
  },

  async updateOnboardingStep(userId, updates) {
    const allowedFields = ['id_verified','id_doc_url','equipment_doc_url','background_check','training_done','onboard_status','mpesa_phone'];
    const sets   = [];
    const params = [userId];
    for (const [key, val] of Object.entries(updates)) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (!allowedFields.includes(col)) continue;
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    }
    if (!sets.length) return null;
    const { rows } = await query(
      `UPDATE provider_profiles SET ${sets.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 RETURNING *`,
      params
    );
    return mapRow(rows[0]);
  },

};

module.exports = { Users, Services, Jobs, Payments, Analytics, ProviderProfiles };
