const express = require('express');

const { asyncHandler, validate, schemas } = require('../errors');

function createPaymentRouter({ auth, requireRole, paymentService }) {
  const router = express.Router();

  router.post('/payments/mpesa', auth, requireRole('motorist'), asyncHandler(async (req, res) => {
    validate(req.body, schemas.mpesaPayment);
    const result = await paymentService.initiatePayment({
      jobId: req.body.jobId,
      phone: req.body.phone,
      userId: req.user.id,
    });
    res.json(result);
  }));

  router.post('/payments/mpesa/callback', asyncHandler(async (req, res) => {
    const result = await paymentService.handleCallback(req.body);
    res.json(result);
  }));

  return router;
}

module.exports = { createPaymentRouter };
