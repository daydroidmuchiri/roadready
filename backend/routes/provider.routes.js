const express = require('express');

const {
  asyncHandler,
  validate,
  schemas,
  NotFoundError,
  ValidationError,
} = require('../errors');

function createProviderRouter({
  auth,
  requireRole,
  Users,
  Jobs,
  ProviderProfiles,
  emitToAdmins,
  io,
}) {
  const router = express.Router();

  router.get('/providers', auth, requireRole('admin'), asyncHandler(async (_req, res) => {
    const providers = await Users.listProviders();
    res.json(providers);
  }));

  router.get('/providers/me', auth, requireRole('provider'), asyncHandler(async (req, res) => {
    const [user, profile, todayStats, recentJobs] = await Promise.all([
      Users.findById(req.user.id),
      ProviderProfiles.findByUserId(req.user.id),
      ProviderProfiles.todayEarnings(req.user.id),
      Jobs.listByProvider(req.user.id),
    ]);
    if (!user) throw new NotFoundError('Provider');
    res.json({
      ...user,
      profile,
      todayEarnings: Number(todayStats?.todayEarnings) || 0,
      todayJobs: Number(todayStats?.todayJobs) || 0,
      recentJobs: recentJobs.slice(0, 10),
    });
  }));

  router.patch('/providers/location', auth, requireRole('provider'), asyncHandler(async (req, res) => {
    validate(req.body, schemas.updateLocation);
    const { location } = req.body;
    if (typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      throw new ValidationError('Validation failed', { location: 'must have numeric lat and lng' });
    }

    await Users.updateLocation(req.user.id, location.lat, location.lng);
    emitToAdmins('provider_location', { providerId: req.user.id, location });
    res.json({ ok: true });
  }));

  router.patch('/providers/status', auth, requireRole('provider'), asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['available', 'offline'].includes(status)) {
      throw new ValidationError('Validation failed', { status: 'must be available or offline' });
    }

    const updated = await Users.updateStatus(req.user.id, status);
    io.emit('provider_status', { providerId: req.user.id, status });
    res.json(updated);
  }));

  router.patch('/providers/device-token', auth, asyncHandler(async (req, res) => {
    const { deviceToken } = req.body;
    if (!deviceToken || typeof deviceToken !== 'string') {
      throw new ValidationError('Validation failed', { deviceToken: 'required string' });
    }
    await Users.updateDeviceToken(req.user.id, deviceToken);
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { createProviderRouter };
const router = express.Router();
const { asyncHandler, validate, schemas, NotFoundError, ValidationError } = require('../errors');
const { Users, Jobs, ProviderProfiles } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');
const { emitToAdmins, broadcast } = require('../services/socket.service');

router.get('/', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const providers = await Users.listProviders();
  res.json(providers);
}));

router.get('/me', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  const [user, profile, todayStats, recentJobs] = await Promise.all([
    Users.findById(req.user.id),
    ProviderProfiles.findByUserId(req.user.id),
    ProviderProfiles.todayEarnings(req.user.id),
    Jobs.listByProvider(req.user.id),
  ]);
  if (!user) throw new NotFoundError('Provider');
  res.json({
    ...user,
    profile,
    todayEarnings: Number(todayStats?.todayEarnings) || 0,
    todayJobs:     Number(todayStats?.todayJobs)     || 0,
    recentJobs:    recentJobs.slice(0, 10),
  });
}));

router.patch('/location', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.updateLocation);
  const { location } = req.body;
  if (typeof location.lat !== 'number' || typeof location.lng !== 'number')
    throw new ValidationError('Validation failed', { location: 'must have numeric lat and lng' });

  await Users.updateLocation(req.user.id, location.lat, location.lng);
  emitToAdmins('provider_location', { providerId: req.user.id, location });
  res.json({ ok: true });
}));

router.patch('/status', auth, requireRole('provider'), asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['available','offline'].includes(status))
    throw new ValidationError('Validation failed', { status: 'must be available or offline' });

  const updated = await Users.updateStatus(req.user.id, status);
  broadcast('provider_status', { providerId: req.user.id, status });
  res.json(updated);
}));

router.patch('/device-token', auth, asyncHandler(async (req, res) => {
  const { deviceToken } = req.body;
  if (!deviceToken || typeof deviceToken !== 'string')
    throw new ValidationError('Validation failed', { deviceToken: 'required string' });
  await Users.updateDeviceToken(req.user.id, deviceToken);
  res.json({ ok: true });
}));

module.exports = router;
