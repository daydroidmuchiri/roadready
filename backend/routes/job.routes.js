const express = require('express');
const router = express.Router();
const { 
  asyncHandler, validate, schemas, 
  NotFoundError, ConflictError, ValidationError, ForbiddenError 
} = require('../errors');
const { Users, Services, Jobs } = require('../db/queries');
const { auth, requireRole } = require('../middleware/auth.middleware');
const { emitToJob, emitToAdmins } = require('../services/socket.service');
const { assignBestProvider } = require('../services/dispatch.service');
const {
  notifyMotoristProviderArrived,
  notifyMotoristJobComplete,
  notifyProviderJobCancelled,
  notifyMotoristJobCancelled,
} = require('../notifications/templates');

router.post('/', auth, requireRole('motorist'), asyncHandler(async (req, res) => {
  validate(req.body, schemas.createJob);
  const { serviceId, location, address } = req.body;

  if (typeof location.lat !== 'number' || typeof location.lng !== 'number')
    throw new ValidationError('Validation failed', { location: 'must have numeric lat and lng' });
  if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180)
    throw new ValidationError('Validation failed', { location: 'coordinates out of range' });

  const service = await Services.findById(serviceId);
  if (!service) throw new NotFoundError('Service');

  const activeJobs = await Jobs.findActiveByMotorist(req.user.id);
  if (activeJobs.length > 0)
    throw new ConflictError(`You already have active job ${activeJobs[0].id}. Complete or cancel it first.`);

  const job = await Jobs.create({
    motoristId: req.user.id,
    serviceId,
    price:      service.price,
    commission: service.commission,
    address:    address.trim(),
    lat:        location.lat,
    lng:        location.lng,
  });

  emitToAdmins('new_job', { ...job, serviceName: service.name, serviceEmoji: service.emoji });

  setTimeout(() => assignBestProvider(job.id, serviceId, location.lat, location.lng), 5000);

  res.status(201).json(job);
}));

router.get('/', auth, asyncHandler(async (req, res) => {
  let jobs;
  if (req.user.role === 'motorist')       jobs = await Jobs.listByMotorist(req.user.id);
  else if (req.user.role === 'provider')  jobs = await Jobs.listByProvider(req.user.id);
  else                                    jobs = await Jobs.listAll();
  res.json(jobs);
}));

router.get('/:id', auth, asyncHandler(async (req, res) => {
  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');
  if (req.user.role === 'motorist' && job.motoristId !== req.user.id)
    throw new ForbiddenError('You do not have access to this job');
  res.json(job);
}));

router.patch('/:id/status', auth, asyncHandler(async (req, res) => {
  validate(req.body, schemas.updateJobStatus);

  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');

  if (req.user.role === 'provider' && job.providerId !== req.user.id)
    throw new ForbiddenError('You are not assigned to this job');

  const roleTransitions = {
    admin:    { searching: ['cancelled'], matched: ['en_route','cancelled'], en_route: ['on_site','cancelled'], on_site: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [] },
    provider: { searching: [], matched: ['en_route','cancelled'], en_route: ['on_site','cancelled'], on_site: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [] },
    motorist: { searching: ['cancelled'], matched: ['cancelled'], en_route: ['cancelled'], on_site: [], in_progress: [], completed: [], cancelled: [] },
  };
  const validTransitions = roleTransitions[req.user.role] || {};
  if (!validTransitions[job.status]?.includes(req.body.status))
    throw new ValidationError('Invalid status transition', {
      status: `Cannot move from '${job.status}' to '${req.body.status}'`,
    });

  const updated = await Jobs.updateStatus(req.params.id, req.body.status, {
    cancelReason: req.body.cancelReason,
  });

  emitToJob(updated.id, updated.motoristId, updated.providerId, 'job_updated', updated);

  const newStatus = req.body.status;
  const providerName = job.providerName || 'Your provider';

  if (newStatus === 'on_site' && job.motoristId) {
    notifyMotoristProviderArrived(job.motoristId, updated, providerName).catch(() => {});
  }
  if (newStatus === 'completed' && job.motoristId) {
    notifyMotoristJobComplete(job.motoristId, updated, providerName).catch(() => {});
  }
  if (newStatus === 'cancelled') {
    const reason = req.body.cancelReason || null;
    if (req.user.role === 'motorist' && job.providerId) {
      notifyProviderJobCancelled(job.providerId, { ...job, serviceName: job.serviceName }).catch(() => {});
    }
    if (req.user.role === 'provider' && job.motoristId) {
      notifyMotoristJobCancelled(job.motoristId, updated, reason).catch(() => {});
    }
  }

  res.json(updated);
}));

router.post('/:id/rating', auth, asyncHandler(async (req, res) => {
  const { rating } = req.body;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ValidationError('Validation failed', { rating: 'must be an integer between 1 and 5' });

  const job = await Jobs.findById(req.params.id);
  if (!job) throw new NotFoundError('Job');
  if (job.status !== 'completed') throw new ConflictError('Can only rate completed jobs');
  if (req.user.role === 'motorist' && job.motoristId !== req.user.id)
    throw new ForbiddenError('Not your job');

  const updated = await Jobs.submitRating(req.params.id, req.user.role, rating);
  res.json(updated);
}));

module.exports = router;
