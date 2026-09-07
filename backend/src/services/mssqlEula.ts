/**
 * The Microsoft SQL Server 2022 licence acceptance gate (plan.md §121.5,
 * §263d).
 *
 * SQL Server is the one app in `apps/` under a proprietary EULA. The §2.b.iv
 * hosting exception that clears it for the setup-and-maintenance model
 * requires an *active human acceptance* asserting a valid licence — so unlike
 * every other app, the backend must never set `ACCEPT_EULA=Y` on its own. It
 * is written here, and only here, when an operator accepts the terms in the
 * dashboard. Until then `apps/mssql` won't start (the executor calls
 * `assertMssqlEulaAccepted`), and the compose file leaves `ACCEPT_EULA`
 * blank so the container exits regardless.
 */

import { query } from '../utils/database';
import { saveServiceEnv } from './appEnv';
import { HttpError } from '../types';

export const MSSQL_SERVICE = 'mssql';
export const MSSQL_EULA_SETTING = 'mssql_eula_accepted';

export interface MssqlEulaAcceptance {
  acceptedAt: string;
  acceptedByUserId: number | null;
  acceptedByName: string | null;
}

/** The recorded acceptance, or null if the terms have never been accepted. */
export async function getMssqlEulaAcceptance(): Promise<MssqlEulaAcceptance | null> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [MSSQL_EULA_SETTING]);
  const raw = result.rows[0]?.value;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MssqlEulaAcceptance>;
    if (!parsed.acceptedAt) {
      return null;
    }
    return {
      acceptedAt: parsed.acceptedAt,
      acceptedByUserId: parsed.acceptedByUserId ?? null,
      acceptedByName: parsed.acceptedByName ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Record acceptance and write `ACCEPT_EULA=Y` into `apps/mssql/.env` so the
 * next start comes up. Returns the stored acceptance.
 */
export async function recordMssqlEulaAcceptance(
  userId: number | null,
  userName: string | null
): Promise<MssqlEulaAcceptance> {
  const acceptance: MssqlEulaAcceptance = {
    acceptedAt: new Date().toISOString(),
    acceptedByUserId: userId,
    acceptedByName: userName,
  };
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [MSSQL_EULA_SETTING, JSON.stringify(acceptance)]
  );
  await saveServiceEnv(MSSQL_SERVICE, { ACCEPT_EULA: 'Y' });
  return acceptance;
}

/**
 * Executor precondition: refuse to start `mssql` until the licence has been
 * accepted. No-op for every other service.
 */
export async function assertMssqlEulaAccepted(serviceName: string): Promise<void> {
  if (serviceName !== MSSQL_SERVICE) {
    return;
  }
  if (await getMssqlEulaAcceptance()) {
    return;
  }
  throw {
    statusCode: 409,
    message:
      'SQL Server needs its Microsoft licence accepted before it can start — open Settings → SQL Server licence and accept the terms.',
  } as HttpError;
}
