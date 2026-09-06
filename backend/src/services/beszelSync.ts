/**
 * Keeps Beszel's own account list in step with the dashboard's users
 * (plan.md §229) — same shape as guacamoleSync.ts, over PocketBase's REST
 * API. Beszel's `TRUSTED_AUTH_HEADER` middleware only ever *looks up* an
 * existing `users` record by the forwarded email (`FindAuthRecordByEmail`,
 * no creation fallback — read straight from `internal/hub/api.go`), so the
 * account has to already exist for SSO to resolve a session. This sync is
 * what makes it exist.
 *
 * Every active dashboard user with `beszel` app-access granted (or a
 * webmaster) gets a Beszel account, created if missing; webmaster/admin map
 * to Beszel's `admin` role, everyone else to `readonly`. A Beszel account
 * that's no longer wanted is deleted — PocketBase auth records have no
 * disable flag (see beszelClient.ts). The first-run seed admin
 * (`BESZEL_ADMIN_EMAIL`, the universal-token owner) is never touched: it's
 * not in the wanted set, and it's explicitly excluded from the delete pass.
 *
 * "Active" mirrors guacamoleSync/autheliaSync: `email` + `password_hash`
 * both set, so it can't drift from what Authelia considers a real account.
 *
 * Every write is best-effort at the call site, same contract as
 * `syncGuacamoleUsersSafe`: a failure is audited and surfaced as a warning,
 * never rolled back onto the dashboard-side change.
 */

import crypto from 'crypto';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { readAppEnvValue } from './appEnv';
import {
  BeszelRole,
  BeszelUser,
  beszelCreateUser,
  beszelDeleteUser,
  beszelListUsers,
  beszelSetUserRole,
  beszelSuperuserLogin,
} from './beszelClient';

const BESZEL_SERVICE = 'beszel';
const ADMIN_EMAIL_KEY = 'BESZEL_ADMIN_EMAIL';
const ADMIN_PASSWORD_KEY = 'BESZEL_ADMIN_PASSWORD';
// Matches apps/beszel/.env.example's default; only used if the .env somehow
// omits the key (the dashboard writes it from the example on first start).
const DEFAULT_ADMIN_EMAIL = 'admin@homelab.local';
// Compose default ${BESZEL_PORT:-10110}; covers a getPublishedUpstreamPort() miss.
const FALLBACK_PORT = 10110;

export interface BeszelSyncResult {
  synced: boolean;
  created: number;
  updated: number;
  deleted: number;
  reason?: 'beszel-not-installed' | 'admin-password-missing' | 'unreachable';
}

interface ManagedUserRow {
  email: string | null;
  password_hash: string | null;
  roles: string[] | null;
  has_beszel_access: boolean;
}

/** Wanted Beszel accounts as `email -> role`. */
async function loadWantedUsers(): Promise<Map<string, BeszelRole>> {
  const { rows } = await query<ManagedUserRow>(`
    SELECT u.email,
           u.password_hash,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.role), NULL) AS roles,
           BOOL_OR(a.service_name = '${BESZEL_SERVICE}') AS has_beszel_access
    FROM users u
    LEFT JOIN user_roles r      ON r.user_id = u.id
    LEFT JOIN user_app_access a ON a.user_id = u.id
    GROUP BY u.id, u.email, u.password_hash
  `);

  const wanted = new Map<string, BeszelRole>();
  for (const row of rows) {
    if (!row.email || !row.password_hash) {
      continue;
    }
    const dashRoles = row.roles ?? [];
    const isAdmin = dashRoles.includes('webmaster') || dashRoles.includes('admin');
    if (isAdmin || row.has_beszel_access) {
      wanted.set(row.email.toLowerCase(), isAdmin ? 'admin' : 'readonly');
    }
  }
  return wanted;
}

async function reconcileUser(
  baseUrl: string,
  token: string,
  email: string,
  wantedRole: BeszelRole | undefined,
  existing: BeszelUser | undefined,
  result: BeszelSyncResult
): Promise<void> {
  if (wantedRole) {
    if (!existing) {
      await beszelCreateUser(baseUrl, token, email, crypto.randomBytes(32).toString('hex'), wantedRole);
      result.created += 1;
      return;
    }
    if (existing.role !== wantedRole) {
      await beszelSetUserRole(baseUrl, token, existing.id, wantedRole);
      result.updated += 1;
    }
    return;
  }

  if (existing) {
    await beszelDeleteUser(baseUrl, token, existing.id);
    result.deleted += 1;
  }
}

/**
 * Rebuild Beszel's account set from the `users` table. Returns without
 * writing anything when Beszel isn't installed, its generated admin password
 * isn't set yet (it has never started), or it's unreachable right now. Never
 * throws; a per-user REST failure is logged and skipped rather than
 * aborting the whole pass.
 */
export async function syncBeszelUsers(trigger: string): Promise<BeszelSyncResult> {
  const result: BeszelSyncResult = { synced: false, created: 0, updated: 0, deleted: 0 };

  if (!resolveComposeFile(BESZEL_SERVICE)?.composeFile) {
    return { ...result, reason: 'beszel-not-installed' };
  }

  const adminPassword = readAppEnvValue(BESZEL_SERVICE, ADMIN_PASSWORD_KEY);
  if (!adminPassword) {
    return { ...result, reason: 'admin-password-missing' };
  }
  const adminEmail = (readAppEnvValue(BESZEL_SERVICE, ADMIN_EMAIL_KEY) || DEFAULT_ADMIN_EMAIL).toLowerCase();

  const port = getPublishedUpstreamPort(BESZEL_SERVICE) ?? FALLBACK_PORT;
  const baseUrl = `http://${await getHostGatewayIp()}:${port}`;

  let token: string | null;
  try {
    token = await beszelSuperuserLogin(baseUrl, adminEmail, adminPassword);
  } catch (error) {
    logger.warn(`Beszel sync (${trigger}): Beszel is not reachable`, { error: (error as Error).message });
    return { ...result, reason: 'unreachable' };
  }
  if (!token) {
    // The seeded superuser password no longer works — changed by hand in
    // Beszel's UI since first run. Nothing this sync can do about that.
    logger.warn(`Beszel sync (${trigger}): the stored admin password was rejected`);
    return { ...result, reason: 'unreachable' };
  }

  const wanted = await loadWantedUsers();
  const existing = new Map<string, BeszelUser>();
  for (const user of await beszelListUsers(baseUrl, token)) {
    existing.set(user.email.toLowerCase(), user);
  }

  const emails = new Set([...wanted.keys(), ...existing.keys()]);
  // Never delete or re-role the first-run seed admin: it owns the agent's
  // universal token (beszel-init) and is not a dashboard-managed account.
  emails.delete(adminEmail);

  for (const email of emails) {
    try {
      await reconcileUser(baseUrl, token, email, wanted.get(email), existing.get(email), result);
    } catch (error) {
      logger.error(`Beszel sync (${trigger}): failed to reconcile ${email}`, { error: (error as Error).message });
    }
  }

  result.synced = true;
  logger.info(
    `Beszel sync (${trigger}): ${result.created} created, ${result.updated} updated, ${result.deleted} deleted`
  );
  return result;
}

/**
 * Fire-and-forget wrapper for the user-management routes: never throws,
 * audits a failure, and hands back a short warning string when the sync
 * didn't fully land. Same contract as `syncGuacamoleUsersSafe`.
 */
export async function syncBeszelUsersSafe(trigger: string, userId: number | null): Promise<string | null> {
  try {
    const result = await syncBeszelUsers(trigger);
    if (result.synced || result.reason === 'beszel-not-installed' || result.reason === 'admin-password-missing') {
      return null;
    }
    return 'The account was saved, but Beszel could not be reached to keep its accounts in sync.';
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Beszel sync (${trigger}) failed: ${message}`);
    await writeAuditLog({
      userId,
      action: 'beszel_users_sync',
      resource: trigger,
      result: 'failure',
      metadata: { error: message },
    }).catch(() => {});
    return 'The account was saved, but updating Beszel failed — check the server logs.';
  }
}
