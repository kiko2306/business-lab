import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../utils/database';
import { hashPassword, verifyPassword } from '../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken, refreshTokenExpiryMs } from '../utils/jwt';
import setupModeMiddleware from '../middleware/setupMode';
import authMiddleware from '../middleware/auth';
import { schemas, validateBody } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpKeyUri,
  totpQrSvg,
  verifyTotp,
} from '../utils/totp';
import { openSecret, sealSecret } from '../utils/totpSecret';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// The SPA probes setup status on every load / route guard, so this needs a
// far roomier budget than the login/setup limiter and must not share its
// counter (a page refresh loop shouldn't be able to lock out real logins).
const statusLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
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
// GET /api/auth/setup-status — public, unauthenticated
//
// Lets the frontend decide between the /setup and /login screens without
// firing an authenticated request that necessarily 401s on a fresh load
// (which shows up as a console error on the login page).
// ---------------------------------------------------------------------------
router.get('/setup-status', statusLimiter, async (_req: Request, res: Response) => {
  try {
    const result = await query<{ cnt: string }>(
      'SELECT COUNT(*) AS cnt FROM users WHERE is_setup_complete = TRUE',
      []
    );
    const setupRequired = parseInt(result.rows[0].cnt, 10) === 0;
    return res.json({ setupRequired });
  } catch (err) {
    console.error('Setup status error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

// ---------------------------------------------------------------------------
// TOTP second factor — enrolment (plan.md §127, slice A)
//
// All authenticated: a signed-in user manages their own second factor. Login
// is not yet gated on it — that is slice B.
// ---------------------------------------------------------------------------

interface TotpUserRow {
  username: string;
  password_hash: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_enrolled_at: string | null;
}

// GET /api/auth/totp/status — what the settings screen renders from.
router.get('/totp/status', authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const result = await query<TotpUserRow>(
      'SELECT totp_enabled, totp_enrolled_at FROM users WHERE id = $1',
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }

    let recoveryCodesRemaining = 0;
    if (row.totp_enabled) {
      const codes = await query<{ n: string }>(
        'SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
        [userId]
      );
      recoveryCodesRemaining = parseInt(codes.rows[0].n, 10);
    }

    return res.json({
      enabled: row.totp_enabled,
      enrolledAt: row.totp_enrolled_at,
      recoveryCodesRemaining,
    });
  } catch (err) {
    console.error('TOTP status error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/totp/setup — mint a pending secret and return the QR/URI.
// Not enabled until /activate proves a code. Re-running replaces an abandoned
// pending secret.
router.post('/totp/setup', authLimiter, authMiddleware, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const result = await query<TotpUserRow>('SELECT username, totp_enabled FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (row.totp_enabled) {
      return res.status(409).json({ error: 'Two-factor authentication is already enabled. Disable it first to re-enrol.' });
    }

    const secret = generateTotpSecret();
    await query('UPDATE users SET totp_secret = $2, totp_enabled = FALSE WHERE id = $1', [userId, sealSecret(secret)]);

    const otpauthUri = totpKeyUri(row.username, secret);
    const qrSvg = await totpQrSvg(otpauthUri);
    return res.json({ otpauthUri, qrSvg, secret });
  } catch (err) {
    console.error('TOTP setup error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/totp/activate — verify a code against the pending secret,
// turn 2FA on, and return the one-time recovery codes.
router.post(
  '/totp/activate',
  authLimiter,
  authMiddleware,
  validateBody(schemas.totpActivate),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { code } = req.body;
    try {
      const result = await query<TotpUserRow>(
        'SELECT totp_secret, totp_enabled FROM users WHERE id = $1',
        [userId]
      );
      const row = result.rows[0];
      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (row.totp_enabled) {
        return res.status(409).json({ error: 'Two-factor authentication is already enabled.' });
      }
      if (!row.totp_secret) {
        return res.status(400).json({ error: 'No pending secret — call POST /auth/totp/setup first.' });
      }

      if (!verifyTotp(code, openSecret(row.totp_secret))) {
        await writeAuditLog({ userId, action: 'totp_activate', resource: 'auth', result: 'failure' }).catch(() => {});
        return res.status(400).json({ error: 'That code is not valid. Check your authenticator app and try again.' });
      }

      const recoveryCodes = generateRecoveryCodes();
      await withTransaction(async (client) => {
        await client.query('UPDATE users SET totp_enabled = TRUE, totp_enrolled_at = NOW() WHERE id = $1', [userId]);
        await client.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);
        for (const rc of recoveryCodes) {
          await client.query('INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [
            userId,
            hashRecoveryCode(rc),
          ]);
        }
      });

      await writeAuditLog({ userId, action: 'totp_activate', resource: 'auth', result: 'success' }).catch(() => {});
      return res.json({ enabled: true, recoveryCodes });
    } catch (err) {
      console.error('TOTP activate error:', (err as Error).message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/auth/totp/disable — turn 2FA off after re-verifying with a current
// code or the account password.
router.post(
  '/totp/disable',
  authLimiter,
  authMiddleware,
  validateBody(schemas.totpDisable),
  async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { code, password } = req.body;
    try {
      const result = await query<TotpUserRow>(
        'SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1',
        [userId]
      );
      const row = result.rows[0];
      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (!row.totp_enabled) {
        return res.status(400).json({ error: 'Two-factor authentication is not enabled.' });
      }

      const verified = password
        ? await verifyPassword(password, row.password_hash)
        : Boolean(row.totp_secret && verifyTotp(code, openSecret(row.totp_secret)));
      if (!verified) {
        await writeAuditLog({ userId, action: 'totp_disable', resource: 'auth', result: 'failure' }).catch(() => {});
        return res.status(400).json({ error: 'Provide a current 6-digit code or your account password.' });
      }

      await withTransaction(async (client) => {
        await client.query(
          'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_enrolled_at = NULL WHERE id = $1',
          [userId]
        );
        await client.query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);
      });

      await writeAuditLog({ userId, action: 'totp_disable', resource: 'auth', result: 'success' }).catch(() => {});
      return res.json({ enabled: false });
    } catch (err) {
      console.error('TOTP disable error:', (err as Error).message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
