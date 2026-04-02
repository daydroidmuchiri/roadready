const express = require('express');
const router = express.Router();
const { asyncHandler, validate, schemas, NotFoundError, ForbiddenError, ConflictError, ExternalServiceError } = require('../errors');
const { Jobs, Payments } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');
const { emitToJob, emitToAdmins } = require('../services/socket.service');
const { initiateStkPush, processCallback } = require('../services/mpesa.service');
const { notifyMotoristPaymentConfirmed } = require('../notifications/templates');

router.post('/mpesa', auth, requireRole('motorist'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.mpesaPayment);
  const { jobId, phone } = req.body;

  const job = await Jobs.findById(jobId);
  if (!job)                           throw new NotFoundError('Job');
  if (job.motoristId !== req.user.id) throw new ForbiddenError('This is not your job');
  if (job.status === 'completed')     throw new ConflictError('This job has already been paid');
  if (job.status === 'cancelled')     throw new ConflictError('Cannot pay for a cancelled job');

  const payment = await Payments.create({
    jobId,
    motoristId: req.user.id,
    amount:     job.price,
    mpesaPhone: phone,
  });

  let checkoutRequestId, merchantRequestId, customerMessage;

  const mpesaConfigured = process.env.MPESA_CONSUMER_KEY && process.env.MPESA_PASSKEY && process.env.MPESA_CALLBACK_URL;

  if (mpesaConfigured) {
    try {
      const mpesaResult = await initiateStkPush({
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

router.post('/mpesa/callback', asyncHandler(async (req, res) => {
  const parsed = processCallback(req.body);
  if (!parsed) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const { checkoutRequestId: CheckoutRequestID, success, resultDesc, mpesaReceiptNumber: receipt } = parsed;

  if (success) {
    const payment = await Payments.confirmByCheckoutId(CheckoutRequestID, receipt);
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

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

module.exports = router;
