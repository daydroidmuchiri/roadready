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
const router = express.Router();
const { asyncHandler } = require('../errors');
const { checkConnection } = require('../db/pool');

router.get('/', asyncHandler(async (req, res) => {
  const dbOk = await checkConnection();
  res.status(dbOk ? 200 : 503).json({
    status:    dbOk ? 'ok' : 'degraded',
    db:        dbOk ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
