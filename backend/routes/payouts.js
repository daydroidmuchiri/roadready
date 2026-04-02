/**
 * RoadReady provider payouts routes.
 *
 * Protected endpoints mounted under /api/payouts.
 * Public Safaricom callback routes live in payoutCallbacks.routes.js.
 */

const express = require('express');
const { initiateB2CPayout, isB2CConfigured } = require('../mpesa_b2c');
const { query, transaction } = require('../db/pool');
const {
  asyncHandler,
  ValidationError,
  ConflictError,
  NotFoundError,
} = require('../errors');

const router = express.Router();

router.get('/me', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       p.*,
       array_length(p.job_ids, 1) AS job_count
     FROM payouts p
     WHERE p.provider_id = $1
     ORDER BY p.initiated_at DESC
     LIMIT 50`,
    [req.user.id],
  );

  res.json(rows.map(row => ({
    id: row.id,
    amount: row.amount,
    jobCount: row.job_count,
    mpesaPhone: row.mpesa_phone,
    mpesaReceipt: row.mpesa_receipt,
    status: row.status,
    initiatedAt: row.initiated_at,
    completedAt: row.completed_at,
  })));
}));

router.get('/me/pending', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       j.id, j.service_id, j.provider_earning, j.completed_at,
       u.name AS motorist_name,
       s.name AS service_name, s.emoji AS service_emoji
     FROM jobs j
     JOIN users u ON j.motorist_id = u.id
     JOIN services s ON j.service_id = s.id
     WHERE j.provider_id = $1
       AND j.status = 'completed'
       AND j.id != ALL(
         SELECT unnest(job_ids) FROM payouts WHERE provider_id = $1
       )
     ORDER BY j.completed_at DESC`,
    [req.user.id],
  );

  const total = rows.reduce((sum, job) => sum + (job.provider_earning || 0), 0);

  res.json({
    jobs: rows,
    totalPending: total,
    jobCount: rows.length,
  });
}));

router.post('/request', asyncHandler(async (req, res) => {
  const { mpesaPhone } = req.body;

  if (!mpesaPhone || !/^(07|01|\+2547|\+2541)\d{8}$/.test(mpesaPhone.trim())) {
    throw new ValidationError('Validation failed', {
      mpesaPhone: 'Must be a valid Kenyan phone number',
    });
  }

  const { rows: pendingJobs } = await query(
    `SELECT j.id, j.provider_earning
     FROM jobs j
     WHERE j.provider_id = $1
       AND j.status = 'completed'
       AND j.id != ALL(
         SELECT unnest(job_ids) FROM payouts WHERE provider_id = $1
       )`,
    [req.user.id],
  );

  if (!pendingJobs.length) {
    throw new ConflictError('No pending earnings to pay out');
  }

  const totalAmount = pendingJobs.reduce((sum, job) => sum + (job.provider_earning || 0), 0);
  const jobIds = pendingJobs.map(job => job.id);

  if (totalAmount < 100) {
    throw new ConflictError(`Minimum payout is KES 100. You have KES ${totalAmount} pending.`);
  }

  const payout = await transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO payouts (provider_id, amount, job_ids, mpesa_phone, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [req.user.id, totalAmount, jobIds, mpesaPhone.trim()],
    );

    return rows[0];
  });

  if (isB2CConfigured()) {
    try {
      const b2cResult = await initiateB2CPayout({
        phone: mpesaPhone.trim(),
        amount: totalAmount,
        payoutId: payout.id,
      });

      await query(
        `UPDATE payouts
         SET status = 'processing', b2c_conversation_id = $1
         WHERE id = $2`,
        [b2cResult.conversationId, payout.id],
      );

      console.log(JSON.stringify({
        level: 'INFO',
        event: 'b2c_initiated',
        payoutId: payout.id,
        conversationId: b2cResult.conversationId,
      }));
    } catch (err) {
      console.error(JSON.stringify({
        level: 'ERROR',
        event: 'b2c_failed',
        message: err.message,
        payoutId: payout.id,
      }));
      await query('UPDATE payouts SET status = \'pending\' WHERE id = $1', [payout.id]);
    }
  } else {
    await query('UPDATE payouts SET status = \'processing\' WHERE id = $1', [payout.id]);
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'payout_queued_manual',
      payoutId: payout.id,
    }));
  }

  console.log(JSON.stringify({
    level: 'INFO',
    event: 'payout_requested',
    providerId: req.user.id,
    amount: totalAmount,
    jobCount: jobIds.length,
  }));

  res.status(201).json({
    id: payout.id,
    amount: totalAmount,
    jobCount: jobIds.length,
    mpesaPhone: mpesaPhone.trim(),
    status: 'processing',
    message: `KES ${totalAmount.toLocaleString()} will be sent to ${mpesaPhone} within 48 hours`,
  });
}));

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT p.*, u.name AS provider_name, u.phone AS provider_phone
     FROM payouts p
     JOIN users u ON p.provider_id = u.id
     ORDER BY p.initiated_at DESC
     LIMIT 100`,
  );

  res.json(rows);
}));

router.patch('/:id/complete', asyncHandler(async (req, res) => {
  const { mpesaReceipt } = req.body;
  if (!mpesaReceipt) {
    throw new ValidationError('Validation failed', { mpesaReceipt: 'required' });
  }

  const { rows } = await query(
    `UPDATE payouts
     SET status = 'completed', mpesa_receipt = $1, completed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [mpesaReceipt, req.params.id],
  );

  if (!rows[0]) {
    throw new NotFoundError('Payout');
  }

  res.json(rows[0]);
}));

module.exports = router;
