/**
 * Periodic exposure drift reconciliation.
 *
 * `POST /api/services/:name/exposure/verify` re-asserts one service's public
 * hostname against the live NPM + Cloudflare state, on demand. Nothing did
 * that on its own — so an NPM proxy host hand-edited to the wrong upstream, a
 * Cloudflare ingress rule deleted in their dashboard, or a rotated token that
 * broke provisioning after the fact, would sit undetected until someone
 * happened to click Re-verify.
 *
 * This runs the same idempotent path (`provisionServiceIfEnabled`) across
 * every exposed service on a slow cadence. A pass that reconciles cleanly is
 * silent bar a log line and a heartbeat setting; a pass that can't bring a
 * service's exposure back to `provisioned` writes an `exposure_reconcile`
 * failure to the audit log, and the service card already shows the
 * `last_error` that `provisionServiceIfEnabled` recorded on the row.
 *
 * Deliberately not gated by a settings toggle: re-asserting an exposure is
 * safe and always wanted where exposure is used at all, and it no-ops when no
 * service is exposed or global exposure config is missing.
 */

import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { SERVICES } from '../config/services';
import { getExposureConfig } from '../utils/exposureSettings';
import { getServiceExposureRow, provisionServiceIfEnabled } from './exposure';
import { regenerateHomepageServices } from './homepageConfig';
import logger from '../utils/logger';

// Exposure drifts only when NPM/Cloudflare is hand-edited or a token rotates,
// so a gentle cadence is plenty; each pass is one Cloudflare + one NPM
// round-trip per exposed service.
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Skip the first pass at boot: NPM, Cloudflare and the apps are still settling
// on a cold start, and each app's own start already provisions its exposure.
// The first reconcile should be a genuine drift check, not startup noise.
const INITIAL_DELAY_MS = 10 * 60 * 1000;
// A trickle between services rather than a burst of API calls.
const BETWEEN_SERVICES_MS = 2_000;

/** Heartbeat: when a reconcile pass last completed. */
export const EXPOSURE_RECONCILE_LAST_RUN_KEY = 'exposure_reconcile_last_run_at';

// "Nobody asked for this" — the same sentinel `reconcileRemovedServices` uses
// for the audit rows `provisionServiceIfEnabled` writes per hostname.
const SYSTEM_USER_ID = 0;

export interface ExposureReconcileSummary {
  checked: number;
  reconciled: number;
  failed: { service: string; error: string }[];
}

/**
 * Re-assert every enabled primary exposure against NPM + Cloudflare. Returns
 * a summary, or null when there is nothing to do (empty registry, or no
 * global exposure config). Never throws.
 */
export async function reconcileExposureDrift(): Promise<ExposureReconcileSummary | null> {
  // An unpopulated registry would look like "every service was un-exposed";
  // refuse rather than churn the whole estate.
  if (!Object.keys(SERVICES).length) {
    logger.error('Skipping exposure reconciliation: the service registry is empty');
    return null;
  }
  if (!(await getExposureConfig())) {
    logger.info('Skipping exposure reconciliation: global exposure settings are not configured');
    return null;
  }

  const rows = await query<{ service_name: string }>(
    `SELECT service_name FROM service_exposure
     WHERE enabled = true AND service_name NOT LIKE '%:%'`
  );
  // Secondary rows (`<service>:<suffix>`) ride along with their primary inside
  // provisionServiceIfEnabled; orphaned names are reconcileRemovedServices' job.
  const services = rows.rows.map((r) => r.service_name).filter((name) => SERVICES[name]);

  const summary: ExposureReconcileSummary = { checked: services.length, reconciled: 0, failed: [] };

  for (const name of services) {
    try {
      const result = await provisionServiceIfEnabled(name, SYSTEM_USER_ID);
      const row = await getServiceExposureRow(name);
      if (result.success && row?.status !== 'failed') {
        summary.reconciled += 1;
      } else {
        summary.failed.push({ service: name, error: row?.last_error ?? result.warning ?? 'unknown error' });
      }
    } catch (error) {
      summary.failed.push({ service: name, error: (error as Error).message });
    }
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_SERVICES_MS));
  }

  // Re-provisioning can flip a hostname from failed to provisioned, which is
  // the point its Home Page tile becomes linkable.
  await regenerateHomepageServices().catch(() => {});

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [EXPOSURE_RECONCILE_LAST_RUN_KEY, new Date().toISOString()]
  ).catch(() => {});

  if (summary.failed.length) {
    logger.warn('Exposure reconciliation: some exposures are unhealthy', { ...summary });
    await writeAuditLog({
      userId: null,
      action: 'exposure_reconcile',
      resource: 'exposure',
      result: 'failure',
      metadata: { ...summary },
    }).catch(() => {});
  } else {
    logger.info('Exposure reconciliation: all exposed services healthy', {
      checked: summary.checked,
      reconciled: summary.reconciled,
    });
  }
  return summary;
}

export function startExposureReconciler(): void {
  setTimeout(() => {
    void reconcileExposureDrift().catch((error: Error) =>
      logger.error('Initial exposure reconciliation failed', { error: error.message })
    );
  }, INITIAL_DELAY_MS);

  setInterval(() => {
    reconcileExposureDrift().catch((error: Error) =>
      logger.error('Exposure reconciliation failed', { error: error.message })
    );
  }, RECONCILE_INTERVAL_MS);
}
