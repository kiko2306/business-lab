/**
 * Wire Nextcloud's "Antivirus for files" (files_antivirus) app to the ClamAV
 * daemon automatically, the same class of §0.2/§0.3 problem as the OnlyOffice
 * connector (nextcloudOnlyOffice.ts) — `occ` inside the Nextcloud container,
 * run through the shared nextcloudOcc scaffold.
 *
 * ClamAV runs as its own compose project (`apps/clamav/`), reachable from
 * Nextcloud's network only via the host gateway + its published port
 * (`CLAMAV_PORT`:3310) — the same cross-project trick the exposure code uses.
 * So the app is configured in `daemon` mode (TCP host + port), not socket.
 *
 * `av_block_unreachable` is set to **false** on purpose: a stopped ClamAV must
 * not turn into "no file can be uploaded to Nextcloud". The background scanner
 * (`files_antivirus` runs one on cron) re-scans everything that was missed
 * once ClamAV is back — its first pass is "files never scanned". `clamav` is
 * added to Nextcloud's `requires` so the dashboard still surfaces the
 * dependency and warns when it is down.
 *
 * Runs after `docker compose up` on every Nextcloud start (occ needs the
 * database). No-op when ClamAV is not part of the deployment. Never fatal.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';
const CLAMAV_SERVICE = 'clamav';
// clamd's own default TCP port inside the container, used if the published
// host port can't be read for some reason.
const CLAMD_DEFAULT_PORT = 3310;

export interface NextcloudClamavPlan {
  host: string;
  port: number;
}

/** The daemon-mode host/port, or null when ClamAV isn't in this deployment. */
export async function buildNextcloudClamavPlan(): Promise<NextcloudClamavPlan | null> {
  if (!resolveComposeFile(CLAMAV_SERVICE)?.composeFile) {
    return null;
  }
  return {
    host: await getHostGatewayIp(),
    port: getPublishedUpstreamPort(CLAMAV_SERVICE) ?? CLAMD_DEFAULT_PORT,
  };
}

/**
 * The occ lines that install + point files_antivirus at clamd. `--type` is
 * given for the non-string values so the new typed app-config store doesn't
 * coerce `"false"` to boolean true.
 */
export function buildAntivirusScript(host: string, port: number): string[] {
  return [
    'if ! php occ app:getpath files_antivirus >/dev/null 2>&1; then',
    '  if ! php occ app:install files_antivirus; then',
    '    echo "hlm: could not install files_antivirus (app store unreachable?); skipping"',
    '    exit 0',
    '  fi',
    'fi',
    'php occ app:enable files_antivirus >/dev/null',
    'php occ config:app:set files_antivirus av_mode --value "daemon"',
    `php occ config:app:set files_antivirus av_host --value "${host}"`,
    `php occ config:app:set files_antivirus av_port --type integer --value "${port}"`,
    // Remove an infected file that the background scan finds already stored
    // (upload-time detection blocks it regardless of this setting).
    'php occ config:app:set files_antivirus av_infected_action --value "delete"',
    // See the file header: ClamAV being down must not block all uploads.
    'php occ config:app:set files_antivirus av_block_unreachable --type boolean --value "false"',
    'echo "hlm: files_antivirus configured"',
  ];
}

/**
 * Reconcile the files_antivirus app on a Nextcloud start. No-op for every
 * other service and when ClamAV is not part of the deployment. Never throws.
 */
export async function reconcileNextcloudClamav(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }
  if (!resolveComposeFile(NEXTCLOUD_SERVICE)?.composeFile) {
    return;
  }

  try {
    const plan = await buildNextcloudClamavPlan();
    if (!plan) {
      logger.info('Skipping the Nextcloud/ClamAV wiring: ClamAV is not part of this deployment');
      return;
    }

    const result = await runNextcloudOccScript(buildAntivirusScript(plan.host, plan.port));
    logger.info('Nextcloud/ClamAV antivirus reconciled', {
      host: plan.host,
      port: plan.port,
      ok: result.ok,
      output: result.output || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to wire Nextcloud to ClamAV', { error: (error as Error).message });
  }
}
