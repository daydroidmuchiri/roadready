const { ConflictError, ExternalServiceError, ForbiddenError, NotFoundError } = require('../errors');

function createPaymentService({
  Payments,
  Jobs,
  initiateSTKPush,
  parseCallback,
  emitToJob,
  emitToAdmins,
  notifyMotoristPaymentConfirmed,
}) {
  async function initiatePayment({ jobId, phone, userId }) {
    const job = await Jobs.findById(jobId);
    if (!job) throw new NotFoundError('Job');
    if (job.motoristId !== userId) throw new ForbiddenError('This is not your job');
    if (job.status === 'completed') throw new ConflictError('This job has already been paid');
    if (job.status === 'cancelled') throw new ConflictError('Cannot pay for a cancelled job');

    const payment = await Payments.create({
      jobId,
      motoristId: userId,
      amount: job.price,
      mpesaPhone: phone,
    });

    let checkoutRequestId;
    let merchantRequestId;
    let customerMessage;

    const mpesaConfigured = process.env.MPESA_CONSUMER_KEY && process.env.MPESA_PASSKEY && process.env.MPESA_CALLBACK_URL;

    if (mpesaConfigured) {
      try {
        const mpesaResult = await initiateSTKPush({
          phone,
          amount: job.price,
          jobId,
          description: `RoadReady - ${job.serviceId}`,
        });
        checkoutRequestId = mpesaResult.checkoutRequestId;
        merchantRequestId = mpesaResult.merchantRequestId;
        customerMessage = mpesaResult.customerMessage;
      } catch (err) {
        throw new ExternalServiceError('M-Pesa', err.message);
      }
    } else {
      checkoutRequestId = 'RR-SIM-' + Date.now();
      merchantRequestId = 'MR-SIM-' + Date.now();
      customerMessage = `[DEV] Simulated payment of KES ${job.price.toLocaleString()} to ${phone}`;

      setTimeout(async () => {
        try {
          const confirmed = await Payments.confirmByCheckoutId(checkoutRequestId, 'SIM' + Date.now());
          if (confirmed) {
            const updatedJob = await Jobs.findById(jobId);
            if (updatedJob?.motoristId) {
              emitToJob(jobId, updatedJob.motoristId, updatedJob.providerId, 'payment_confirmed', { jobId, ref: checkoutRequestId });
              emitToJob(jobId, updatedJob.motoristId, updatedJob.providerId, 'job_updated', updatedJob);
              notifyMotoristPaymentConfirmed(updatedJob.motoristId, updatedJob, checkoutRequestId).catch(() => {});
            }
          }
        } catch (err) {
          console.error(JSON.stringify({ level: 'ERROR', event: 'sim_payment_failed', message: err.message }));
        }
      }, 3000);
    }

    await Payments.updateCheckoutRequestId(payment.id, checkoutRequestId, merchantRequestId);
    return { success: true, checkoutRequestId, customerMessage };
  }

  async function handleCallback(body) {
    const parsed = parseCallback(body);
    if (!parsed) return { ResultCode: 0, ResultDesc: 'Accepted' };

    const {
      checkoutRequestId: checkoutRequestID,
      success,
      resultDesc,
      mpesaReceiptNumber: receipt,
    } = parsed;

    if (success) {
      const payment = await Payments.confirmByCheckoutId(checkoutRequestID, receipt);
      if (payment?.jobId) {
        const job = await Jobs.findById(payment.jobId);
        if (job) {
          emitToJob(job.id, job.motoristId, job.providerId, 'payment_confirmed', { jobId: job.id, ref: checkoutRequestID });
          emitToJob(job.id, job.motoristId, job.providerId, 'job_updated', job);
          notifyMotoristPaymentConfirmed(job.motoristId, job, receipt).catch(() => {});
        }
      }
    } else {
      await Payments.failByCheckoutId(checkoutRequestID, resultDesc || 'Payment failed');
      emitToAdmins('payment_failed', { checkoutRequestId: checkoutRequestID, reason: resultDesc });
    }

    return { ResultCode: 0, ResultDesc: 'Accepted' };
  }

  return { initiatePayment, handleCallback };
}

module.exports = { createPaymentService };
