import { query } from './database';
import logger from './logger';

const RETENTION_DAYS = 30;

/** Delete audit_logs rows older than the retention window. Returns rows removed. */
export async function purgeOldAuditLogs(): Promise<number> {
  const result = await query(
    `DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
  );
  return result.rowCount ?? 0;
}

/**
 * Delete refresh tokens that can never be used again: expired, or revoked
 * (logout, password reset). `/auth/refresh` answers a missing row exactly as
 * it answers a revoked or expired one, so this changes no behaviour. Nothing
 * else ever deleted them: home-srv-01 had 261 dead rows of 267 (§523).
 */
export async function purgeDeadRefreshTokens(): Promise<number> {
  const result = await query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked');
  return result.rowCount ?? 0;
}

export function startAuditLogPurgeSweeper(): void {
  const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
  const run = () => {
    purgeOldAuditLogs()
      .then((deleted) => {
        if (deleted > 0) {
          logger.info('Purged audit logs past the retention window', { deleted, retentionDays: RETENTION_DAYS });
        }
      })
      .catch((error: Error) => {
        logger.error('Audit log purge failed', { error: error.message });
      });
    // Same cadence, same kind of housekeeping; its own catch so one failing
    // doesn't hide the other.
    purgeDeadRefreshTokens()
      .then((deleted) => {
        if (deleted > 0) logger.info('Purged expired or revoked refresh tokens', { deleted });
      })
      .catch((error: Error) => {
        logger.error('Refresh token purge failed', { error: error.message });
      });
  };
  run();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}

interface WriteAuditLogOptions {
  userId?: number | null;
  action: string;
  resource?: string | null;
  result?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Never throws: the audit row records an action, it never decides whether the
 * action happens. Callers used to each add `.catch(() => {})`, and the ones
 * that forgot turned an audit insert failure into a 500 *after* the action had
 * already taken effect (a login whose session was already issued).
 */
export async function writeAuditLog({
  userId = null,
  action,
  resource = null,
  result = 'success',
  metadata = {},
}: WriteAuditLogOptions): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, resource, result, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, resource, result, JSON.stringify(metadata ?? {})]
    );
  } catch (error) {
    logger.error('Audit log write failed', { action, resource, error: (error as Error).message });
  }
}
