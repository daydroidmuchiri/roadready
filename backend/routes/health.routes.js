const express = require('express');
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
