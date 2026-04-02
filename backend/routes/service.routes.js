const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../errors');
const { Services } = require('../db/queries');

router.get('/', asyncHandler(async (req, res) => {
  const services = await Services.list();
  res.json(services);
}));

module.exports = router;
