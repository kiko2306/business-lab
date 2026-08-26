import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { isRecoveryModeEnabled, isLocalRequest } from '../utils/recovery';

/**
 * Express middleware that validates the JWT access token.
 * Attaches the decoded user payload to req.user on success.
 * Returns 401 for missing or invalid tokens.
 */
export default async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    if ((await isRecoveryModeEnabled()) && !isLocalRequest(req)) {
      return res.status(503).json({
        error: 'Recovery mode is enabled. API access is restricted to localhost.',
        recoveryMode: true,
      });
    }
  } catch {
    return res.status(500).json({ error: 'Unable to verify recovery mode status.' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
