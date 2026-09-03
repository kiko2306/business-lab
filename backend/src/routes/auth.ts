import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../utils/database';
import { hashPassword, verifyPassword } from '../utils/password';
import {
  signAccessToken,
  signRefreshToken,
  signMfaToken,
  verifyMfaToken,
  verifyRefreshToken,
  refreshTokenExpiryMs,
} from '../utils/jwt';
import setupModeMiddleware from '../middleware/setupMode';
import authMiddleware from '../middleware/auth';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';
import { effectiveCapabilities } from '../auth/capabilities';
import { getUserCapabilities, getUserRoles, setUserRoles } from '../services/userRoles';
import { acceptInvitation, verifyInvitation } from '../services/userInvitations';
import { syncAutheliaUsersSafe } from '../services/autheliaSync';
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
  totp_enabled?: boolean;
}

/**
 * Issue an access + refresh token pair for a fully-authenticated user and
 * persist the refresh token. The shared tail of a password-only login and the
 * second step of a 2FA login.
 */
async function issueSession(user: { id: number; username: string }): Promise<{
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; roles: string[]; capabilities: string[] };
}> {
  const [roles, grants] = await Promise.all([getUserRoles(user.id), getUserCapabilities(user.id)]);
  const capabilities = effectiveCapabilities(roles, grants);
  const accessToken = signAccessToken({ id: user.id, username: user.username, roles });
  const refreshToken = signRefreshToken({ id: user.id });
  const refreshExpiry = new Date(Date.now() + refreshTokenExpiryMs());
  await query('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [
    user.id,
    refreshToken,
    refreshExpiry,
  ]);
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, username: user.username, roles, capabilities },
  };
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
// GET /api/auth/invitation/:token — public; what the set-password screen
// renders. 410 when the token is unknown, spent or expired (plan.md §158).
// ---------------------------------------------------------------------------
router.get(
  '/invitation/:token',
  authLimiter,
  validateParams(schemas.invitationToken),
  async (req: Request, res: Response) => {
    try {
      const target = await verifyInvitation(req.params.token);
      if (!target) {
        return res.status(410).json({ error: 'This invitation link is no longer valid. Ask for a new one.' });
      }
      return res.json({ username: target.username, email: target.email });
    } catch (err) {
      console.error('Invitation lookup error:', (err as Error).message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/auth/invitation/:token — public; redeem the token by setting a
// password. Activates the account and returns a session (plan.md §158).
// ---------------------------------------------------------------------------
router.post(
  '/invitation/:token',
  authLimiter,
  validateParams(schemas.invitationToken),
  validateBody(schemas.invitationAccept),
  async (req: Request, res: Response) => {
    const { password } = req.body as { password: string };
    try {
      const passwordHash = await hashPassword(password);
      const activated = await acceptInvitation(req.params.token, passwordHash);
      if (!activated) {
        return res.status(410).json({ error: 'This invitation link is no longer valid. Ask for a new one.' });
      }

      await writeAuditLog({
        userId: activated.userId,
        action: 'invitation_accepted',
        resource: activated.username,
        result: 'success',
      }).catch(() => {});

      // The account now has a password hash — write it into Authelia (§157).
      await syncAutheliaUsersSafe('invitation_accepted', activated.userId);

      const session = await issueSession({ id: activated.userId, username: activated.username });
      return res.json(session);
    } catch (err) {
      console.error('Invitation accept error:', (err as Error).message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

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

    // The first account is the webmaster — every capability, always (§152).
    await setUserRoles(user.id, ['webmaster']);
    const roles = ['webmaster'];
    const capabilities = effectiveCapabilities(roles);

    const accessToken = signAccessToken({ id: user.id, username: user.username, roles });
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

    return res.status(201).json({
      accessToken,
      refreshToken,
      user: { id: user.id, username: user.username, roles, capabilities },
    });
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
    const result = await query<UserRow>(
      'SELECT id, username, password_hash, totp_enabled FROM users WHERE username = $1',
      [username]
    );
    const user = result.rows[0];

    // An invited account has no password hash yet (plan.md §158) — it can't be
    // logged into, and saying so is more useful than "invalid credentials".
    if (user && !user.password_hash) {
      return res
        .status(403)
        .json({ error: "This account hasn't been activated yet — check your email for the set-password link." });
    }

    if (!user || !(await verifyPassword(password, user.password_hash ?? ''))) {
      await writeAuditLog({
        action: 'login',
        resource: 'auth',
        result: 'failure',
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Password is right but a second factor is due: hand back a short-lived
    // token to spend at /auth/login/totp. No session is created yet.
    if (user.totp_enabled) {
      await writeAuditLog({ userId: user.id, action: 'login_mfa_challenge', resource: 'auth', result: 'success' }).catch(
        () => {}
      );
      return res.status(202).json({ mfaRequired: true, mfaToken: signMfaToken(user.id) });
    }

    const session = await issueSession(user);
    await writeAuditLog({ userId: user.id, action: 'login', resource: 'auth', result: 'success' });
    return res.json(session);
  } catch (err) {
    console.error('Login error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login/totp — second step of a 2FA login
//
// Takes the mfaToken from /auth/login plus a 6-digit TOTP code or a recovery
// code. On success it issues the real session.
// ---------------------------------------------------------------------------
router.post('/login/totp', authLimiter, validateBody(schemas.authLoginTotp), async (req: Request, res: Response) => {
  const { mfaToken, code } = req.body as { mfaToken: string; code: string };

  let userId: number;
  try {
    userId = verifyMfaToken(mfaToken).id;
  } catch {
    return res.status(401).json({ error: 'This login attempt has expired. Start again.' });
  }

  try {
    const result = await query<{ id: number; username: string; totp_secret: string | null; totp_enabled: boolean }>(
      'SELECT id, username, totp_secret, totp_enabled FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];
    if (!user || !user.totp_enabled || !user.totp_secret) {
      return res.status(401).json({ error: 'This login attempt has expired. Start again.' });
    }

    const trimmed = code.trim();
    const isTotpShape = /^\d{6}$/.test(trimmed);

    let ok = false;
    let viaRecoveryCode = false;

    if (isTotpShape) {
      ok = verifyTotp(trimmed, openSecret(user.totp_secret));
    } else {
      // Recovery code: consume it in the same statement that checks it, so a
      // replay or a race can't spend it twice.
      const consumed = await query<{ id: number }>(
        `UPDATE totp_recovery_codes SET used_at = NOW()
         WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
         RETURNING id`,
        [userId, hashRecoveryCode(trimmed)]
      );
      ok = consumed.rowCount === 1;
      viaRecoveryCode = ok;
    }

    if (!ok) {
      await writeAuditLog({ userId, action: 'login_mfa', resource: 'auth', result: 'failure' }).catch(() => {});
      return res.status(401).json({ error: 'That code is not valid.' });
    }

    const session = await issueSession(user);
    await writeAuditLog({ userId, action: 'login_mfa', resource: 'auth', result: 'success' });
    if (viaRecoveryCode) {
      await writeAuditLog({ userId, action: 'login_recovery_code_used', resource: 'auth', result: 'success' }).catch(
        () => {}
      );
    }
    return res.json(session);
  } catch (err) {
    console.error('TOTP login error:', (err as Error).message);
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

    const [roles, grants] = await Promise.all([
      getUserRoles(decoded.id),
      getUserCapabilities(decoded.id),
    ]);
    const accessToken = signAccessToken({ id: decoded.id, username: row.username, roles });
    return res.json({ accessToken, roles, capabilities: effectiveCapabilities(roles, grants) });
  } catch {
    return res.status(401).json({ error: 'Refresh token is invalid or expired' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me — the signed-in user's identity, roles and the dashboard
// capabilities those roles grant. The frontend gates nav and buttons on the
// capability list rather than re-deriving the role→capability map.
// ---------------------------------------------------------------------------
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const result = await query<{ username: string }>('SELECT username FROM users WHERE id = $1', [userId]);
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const [roles, grants] = await Promise.all([getUserRoles(userId), getUserCapabilities(userId)]);
    return res.json({
      id: userId,
      username: row.username,
      roles,
      capabilities: effectiveCapabilities(roles, grants),
    });
  } catch (err) {
    console.error('Auth me error:', (err as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
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
