/**
 * A single in-process serial lock shared by the operations that must not run
 * while an app's containers are being recreated: the app-data backup dump
 * (backupScheduler.runAppDataBackup) and an app's own pull+recreate as part
 * of a self-update's app-update batch (executor.pullAndRecreateService,
 * called from updateAllInstalledApps — §209).
 *
 * Why they conflict: `pullAndRecreateService` does `docker compose pull` +
 * `up -d --force-recreate`, which stops and replaces a container. If that
 * lands mid-dump, `pg_dump`/`mariadb-dump` against that app aborts and the
 * backup is silently short a database (§103 is the ordering rule for the
 * dump itself; this is the same rule extended to updates). Serialising them
 * is enough — an update waiting ~20s for a dump to finish, or a scheduled
 * dump waiting for a pull, is fine; both retry or re-run on their own
 * cadence.
 *
 * Deliberately process-local, not a Postgres advisory lock: there is exactly
 * one backend process driving compose, and a DB-backed lock would add a
 * failure mode (stuck lock after a crash) for no gain here.
 */

import logger from '../utils/logger';

// The tail of the queue. Every acquirer chains onto it; the tail is reset to a
// never-rejecting continuation so one failed holder can't wedge the queue.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` once every previously-queued holder has settled. Returns whatever
 * `fn` returns (or rejects with whatever it throws) — the lock is released
 * regardless.
 */
export function withMaintenanceLock<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const runsAfter = tail;
  const result = runsAfter.then(() => {
    logger.debug('Maintenance lock acquired', { label });
    return fn();
  });
  // Swallow both the predecessor's and this holder's outcome for the *queue*
  // pointer only; `result` still surfaces fn's real outcome to the caller.
  tail = result.then(
    () => logger.debug('Maintenance lock released', { label }),
    () => logger.debug('Maintenance lock released after failure', { label })
  );
  return result;
}
