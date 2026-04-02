function createDispatchService({
  Users,
  Jobs,
const { Users, Jobs } = require('../db/queries');
const { emitToJob, emitToAdmins } = require('./socket.service');
const {
  notifyProviderNewJob,
  notifyMotoristProviderMatched,
  notifyMotoristNoProviders,
  notifyAdminsJobStuck,
  emitToJob,
}) {
  const MAX_DISPATCH_ATTEMPTS = 5;

  async function assignBestProvider(jobId, serviceId, lat, lng, attempt = 1) {
    try {
      const job = await Jobs.findById(jobId);
      if (!job || job.status !== 'searching') return;

      const nearby = await Users.findAvailableProvidersNearby(serviceId, lat, lng, 25);

      if (!nearby.length) {
        console.warn(JSON.stringify({ level: 'WARN', event: 'no_providers', jobId, serviceId, attempt }));
        emitToJob(jobId, job.motoristId, null, 'job_no_providers', { jobId, message: 'No providers nearby right now. Still searching…' });
        notifyMotoristNoProviders(job.motoristId, jobId).catch(() => {});

        if (attempt >= MAX_DISPATCH_ATTEMPTS) {
          console.error(JSON.stringify({ level: 'ERROR', event: 'dispatch_exhausted', jobId, attempts: attempt }));
          const admins = await Users.listAdmins().catch(() => []);
          notifyAdminsJobStuck(admins.map(a => a.id), job).catch(() => {});
          return;
        }

        const ageMin = (Date.now() - new Date(job.createdAt).getTime()) / 60000;
        if (ageMin > 10) {
          const admins = await Users.listAdmins().catch(() => []);
          notifyAdminsJobStuck(admins.map(a => a.id), job).catch(() => {});
        }

        setTimeout(() => assignBestProvider(jobId, serviceId, lat, lng, attempt + 1), 30000);
        return;
      }

      const best = nearby
        .map(p => ({
          provider: p,
          score: (Number(p.rating) * 0.6) + ((1 / (Number(p.distanceKm) + 0.1)) * 0.4),
        }))
        .sort((a, b) => b.score - a.score)[0].provider;

      const updated = await Jobs.assignProvider(jobId, best.id);
      if (!updated) return;

      const matchPayload = {
        jobId,
        provider: {
          id: best.id,
          name: best.name,
          rating: best.rating,
          location: { lat: Number(best.lat), lng: Number(best.lng) },
        },
      };
      emitToJob(jobId, job.motoristId, best.id, 'job_matched', matchPayload);
      emitToJob(jobId, job.motoristId, best.id, 'job_updated', updated);

      notifyProviderNewJob(best.id, {
        ...updated,
        serviceName: job.serviceName,
        serviceEmoji: job.serviceEmoji,
        providerEarning: updated.providerEarning,
      }, Number(best.distanceKm)).catch(() => {});

      const etaMinutes = Math.round((Number(best.distanceKm) / 30) * 60);
      notifyMotoristProviderMatched(job.motoristId, updated, best, etaMinutes).catch(() => {});

      console.log(JSON.stringify({
        level: 'INFO',
        event: 'job_matched',
        jobId,
        providerId: best.id,
        distanceKm: best.distanceKm,
      }));
    } catch (err) {
      console.error(JSON.stringify({ level: 'ERROR', event: 'dispatch_failed', jobId, message: err.message }));
    }
  }

  return { assignBestProvider, MAX_DISPATCH_ATTEMPTS };
}

module.exports = { createDispatchService };
} = require('../notifications/templates');

const MAX_DISPATCH_ATTEMPTS = 5;   // give up after ~2.5 minutes of retrying

async function assignBestProvider(jobId, serviceId, lat, lng, attempt = 1) {
  try {
    // Re-check job is still searching
    const job = await Jobs.findById(jobId);
    if (!job || job.status !== 'searching') return;

    const nearby = await Users.findAvailableProvidersNearby(serviceId, lat, lng, 25);

    if (!nearby.length) {
      console.warn(JSON.stringify({ level: 'WARN', event: 'no_providers', jobId, serviceId, attempt }));
      emitToJob(jobId, job.motoristId, null, 'job_no_providers', { jobId, message: 'No providers nearby right now. Still searching…' });
      // Notify motorist via push (app may be in background)
      notifyMotoristNoProviders(job.motoristId, jobId).catch(() => {});

      if (attempt >= MAX_DISPATCH_ATTEMPTS) {
        // Exhausted all retries — alert admins and stop
        console.error(JSON.stringify({ level: 'ERROR', event: 'dispatch_exhausted', jobId, attempts: attempt }));
        const admins = await Users.listAdmins().catch(() => []);
        notifyAdminsJobStuck(admins.map(a => a.id), job).catch(() => {});
        return;
      }

      // Alert admins if job has been stuck >10 min
      const ageMin = (Date.now() - new Date(job.createdAt).getTime()) / 60000;
      if (ageMin > 10) {
        const admins = await Users.listAdmins().catch(() => []);
        notifyAdminsJobStuck(admins.map(a => a.id), job).catch(() => {});
      }
      // Retry in 30 seconds with wider radius
      setTimeout(() => assignBestProvider(jobId, serviceId, lat, lng, attempt + 1), 30000);
      return;
    }

    // Score: weighted combination of proximity and rating
    const best = nearby
      .map(p => ({
        provider: p,
        score: (Number(p.rating) * 0.6) + ((1 / (Number(p.distanceKm) + 0.1)) * 0.4),
      }))
      .sort((a, b) => b.score - a.score)[0].provider;

    // Transaction: lock job row + assign provider atomically
    const updated = await Jobs.assignProvider(jobId, best.id);
    if (!updated) return;   // race condition — already matched

    const matchPayload = {
      jobId,
      provider: { id: best.id, name: best.name, rating: best.rating, location: { lat: Number(best.lat), lng: Number(best.lng) } },
    };
    emitToJob(jobId, job.motoristId, best.id, 'job_matched', matchPayload);
    emitToJob(jobId, job.motoristId, best.id, 'job_updated', updated);

    // Push notification to provider — alert with 60s expiry
    notifyProviderNewJob(best.id, {
      ...updated,
      serviceName:     job.serviceName,
      serviceEmoji:    job.serviceEmoji,
      providerEarning: updated.providerEarning,
    }, Number(best.distanceKm)).catch(() => {});

    // Push notification to motorist — help is on the way
    const etaMinutes = Math.round((Number(best.distanceKm) / 30) * 60);  // rough ETA at 30km/h
    notifyMotoristProviderMatched(job.motoristId, updated, best, etaMinutes).catch(() => {});

    console.log(JSON.stringify({ level: 'INFO', event: 'job_matched', jobId, providerId: best.id, distanceKm: best.distanceKm }));

  } catch (err) {
    console.error(JSON.stringify({ level: 'ERROR', event: 'dispatch_failed', jobId, message: err.message }));
  }
}

module.exports = { assignBestProvider };
