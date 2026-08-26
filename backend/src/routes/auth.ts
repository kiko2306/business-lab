import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../utils/database';
import { hashPassword, verifyPassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken, refreshTokenExpiryMs } from '../utils/jwt';
import setupModeMiddleware from '../middleware/setupMode';
import authMiddleware from '../middleware/auth';
import { schemas, validateBody } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

interface UserRow {
  id: number;
  username: string;
  password_hash?: string;
}

// ---------------------------------------------------------------------------
// POST /api/auth/setup — create the first admin user
// ---------------------------------------------------------------------------
router.post('/setup', authLimiter, setupModeMiddleware(true), validateBody(schemas.authSetup), async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    const passwordHash = await hashPassword(password);
    const result = await query<UserRow>(
      `INSERT INTO users (username, password_hash, is_setup_complete)
       VALUES ($1, $2, TRUE)
       RETURNING id, username`,
      [username.trim(), passwordHash]
    );
    const user = result.rows[0];

    const accessToken = signAccessToken({ id: user.id, username: user.username });
    const refreshToken = signRefreshToken({ id: user.id });

    const refreshExpiry = new Date(Date.now() + refreshTokenExpiryMs());
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [
      user.id,
      refreshToken,
      refreshExpiry,
    ]);

    await query('INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)', [
      user.id,
      'setup',
      'users',
      'success',
    ]);

    return res.status(201).json({ accessToken, refreshToken, user: { id: user.id, username: user.username } });
  } catch (err) {
    const error = err as { code?: string; message: string };
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Setup error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', authLimiter, validateBody(schemas.authLogin), async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    const result = await query<UserRow>('SELECT id, username, password_hash FROM users WHERE username = $1', [
      username,
    ]);
    const user = result.rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash ?? ''))) {
      await writeAuditLog({
        action: 'login',
        resource: 'auth',
        result: 'failure',
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const accessToken = signAccessToken({ id: user.id, username: user.username });
    const refreshToken = signRefreshToken({ id: user.id });

    const refreshExpiry = new Date(Date.now() + refreshTokenExpiryMs());
    await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [
      user.id,
      refreshToken,
      refreshExpiry,
    ]);

    await writeAuditLog({ userId: user.id, action: 'login', resource: 'auth', result: 'success' });

    return res.json({ accessToken, refreshToken, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('Login error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post('/logout', authLimiter, authMiddleware, validateBody(schemas.authLogout), async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const userId = req.user!.id;

  if (refreshToken) {
    try {
      await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1 AND user_id = $2', [
        refreshToken,
        userId,
      ]);
    } catch (err) {
      console.error('Logout token revoke error:', (err as Error).message);
    }
  }

  try {
    await writeAuditLog({ userId, action: 'logout', resource: 'auth', result: 'success' });
  } catch (err) {
    console.error('Audit log error:', (err as Error).message);
  }

  return res.json({ message: 'Logged out successfully' });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
router.post('/refresh', authLimiter, validateBody(schemas.authRefresh), async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const result = await query<{ id: number; user_id: number; revoked: boolean; expires_at: string; username: string }>(
      `SELECT rt.id, rt.user_id, rt.revoked, rt.expires_at,
              u.username
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1`,
      [refreshToken]
    );
    const row = result.rows[0];

    if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token is invalid or expired' });
    }

    const accessToken = signAccessToken({ id: decoded.id, username: row.username });
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Refresh token is invalid or expired' });
  }
});

export default router;
