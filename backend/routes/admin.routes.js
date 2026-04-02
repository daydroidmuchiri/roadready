const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../errors');
const { Analytics } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');

router.get('/dashboard', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const data = await Analytics.dashboard();
  res.json(data);
}));

module.exports = router;
