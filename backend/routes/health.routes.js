const express = require('express');

const { asyncHandler } = require('../errors');

function createHealthRouter({ checkConnection }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (_req, res) => {
    const dbOk = await checkConnection();
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'connected' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }));

  return router;
}

module.exports = { createHealthRouter };
