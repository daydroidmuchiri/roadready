const jwt = require('jsonwebtoken');

const { AuthError, ForbiddenError } = require('../errors');

function createAuthMiddleware(jwtSecret) {
  return function auth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return next(new AuthError('No token provided'));
    try {
      req.user = jwt.verify(token, jwtSecret);
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return next(new AuthError('Token expired — please log in again'));
      }
      next(new AuthError('Invalid token'));
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(new ForbiddenError(`Requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

module.exports = { createAuthMiddleware, requireRole };
