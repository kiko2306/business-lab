'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../utils/database');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signAccessToken, signRefreshToken, verifyRefreshToken, refreshTokenExpiryMs } = require('../utils/jwt');
const setupModeMiddleware = require('../middleware/setupMode');
const authMiddleware = require('../middleware/auth');

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// ---------------------------------------------------------------------------
// POST /api/auth/setup — create the first admin user
// ---------------------------------------------------------------------------
router.post('/setup', authLimiter, setupModeMiddleware(true), async (req, res) => {
  const { username, password } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (username, password_hash, role, is_setup_complete)
       VALUES ($1, $2, 'admin', TRUE)
       RETURNING id, username, role`,
      [username.trim(), passwordHash]
    );
    const user = result.rows[0];

    const accessToken = signAccessToken({ id: user.id, username: user.username, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });

    const refreshExpiry = new Date(Date.now() + refreshTokenExpiryMs());
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, refreshExpiry]
    );

    await query(
      'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
      [user.id, 'setup', 'users', 'success']
    );

    return res.status(201).json({ accessToken, refreshToken, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Setup error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await query(
      'SELECT id, username, password_hash, role FROM users WHERE username = $1',
      [username]
    );
    const user = result.rows[0];

    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const accessToken = signAccessToken({ id: user.id, username: user.username, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id });

    const refreshExpiry = new Date(Date.now() + refreshTokenExpiryMs());
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, refreshExpiry]
    );

    await query(
      'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
      [user.id, 'login', 'auth', 'success']
    );

    return res.json({ accessToken, refreshToken, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post('/logout', authLimiter, authMiddleware, async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    try {
      await query(
        'UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1 AND user_id = $2',
        [refreshToken, req.user.id]
      );
    } catch (err) {
      console.error('Logout token revoke error:', err.message);
    }
  }

  try {
    await query(
      'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'logout', 'auth', 'success']
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }

  return res.json({ message: 'Logged out successfully' });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------
router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    const result = await query(
      `SELECT rt.id, rt.user_id, rt.revoked, rt.expires_at,
              u.username, u.role
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1`,
      [refreshToken]
    );
    const row = result.rows[0];

    if (!row || row.revoked || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token is invalid or expired' });
    }

    const accessToken = signAccessToken({ id: decoded.id, username: row.username, role: row.role });
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'Refresh token is invalid or expired' });
  }
});

module.exports = router;
