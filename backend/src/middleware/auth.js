'use strict';

const { verifyAccessToken } = require('../utils/jwt');

/**
 * Express middleware that validates the JWT access token.
 * Attaches the decoded user payload to req.user on success.
 * Returns 401 for missing or invalid tokens.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
