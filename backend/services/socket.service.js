const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { Users, Jobs } = require('../db/queries');

let io; // Hold the instance

function initSocket(httpServer) {
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
  io = new Server(httpServer, {
    cors:         { origin: CLIENT_ORIGIN, methods: ['GET','POST'] },
    pingTimeout:  20000,
    pingInterval: 10000,
  });

  const locationDebounce = new Map();

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
    catch { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
    }
    if (socket.user?.role === 'admin') {
      socket.join('admins');
    }

    socket.on('update_location', async ({ location }) => {
      try {
        if (socket.user?.role !== 'provider') return;
        if (typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return;

        clearTimeout(locationDebounce.get(socket.user.id));
        locationDebounce.set(socket.user.id, setTimeout(async () => {
          await Users.updateLocation(socket.user.id, location.lat, location.lng).catch(() => {});
          locationDebounce.delete(socket.user.id);
        }, 8000));
        
        const activeJob = await Jobs.findActiveJobByProvider(socket.user.id).catch(() => null);
        if (activeJob?.motoristId) {
          emitToJob(activeJob.id, activeJob.motoristId, socket.user.id,
            'provider_location', { providerId: socket.user.id, location });
        }
      } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', event: 'ws_location_error', message: err.message }));
      }
    });

    socket.on('error',      err    => console.error(JSON.stringify({ level: 'ERROR', event: 'ws_error', message: err.message })));
    socket.on('disconnect', reason => console.log(JSON.stringify({ level: 'INFO', event: 'ws_disconnected', userId: socket.user?.id, reason })));
  });

  return io;
}

function emitToJob(jobId, motoristId, providerId, event, data) {
  if (motoristId) io.to(`user:${motoristId}`).emit(event, data);
  if (providerId) io.to(`user:${providerId}`).emit(event, data);
  io.to('admins').emit(event, data);
}

function emitToUser(userId, event, data) {
  io.to(`user:${userId}`).emit(event, data);
}

function emitToAdmins(event, data) {
  io.to('admins').emit(event, data);
}

module.exports = { initSocket, emitToJob, emitToUser, emitToAdmins };
