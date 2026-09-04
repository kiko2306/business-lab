/**
 * Wire Nextcloud's ONLYOFFICE connector to the OnlyOffice Document Server
 * automatically, because §0.2 forbids a human `occ` step and §0.3 says the
 * system configures what it can derive.
 *
 * What has to happen on the Nextcloud side: install + enable the `onlyoffice`
 * app, and set four values — the document-server URL the browser loads the
 * editor from, the internal URL Nextcloud uses server-to-server, the URL
 * OnlyOffice calls back on, and the shared JWT secret. All of that is `occ`
 * inside the Nextcloud container.
 *
 * How: a throwaway `docker compose run` container built from Nextcloud's own
 * image + volume, run as `www-data` (occ refuses to run as root), exactly the
 * pattern homeAssistantHacs.ts uses. `docker compose exec` is not an option —
 * the backend reaches Docker through the socket-proxy, which blocks exec.
 *
 * Cross-project networking (Nextcloud and OnlyOffice are separate compose
 * projects on separate bridges): the same trick the exposure code and ClamAV
 * use — the host gateway IP plus each app's published port. So the internal
 * legs are `http://<gateway>:<port>/`, and the browser-facing URL is
 * OnlyOffice's public hostname when it is exposed (§123.2: it must be, the
 * remote browser loads the editor from it), falling back to the gateway URL
 * for a LAN-only deployment.
 *
 * Runs on every Nextcloud start, like HACS: a fresh clone, a reinstall and a
 * changed OnlyOffice hostname all converge on the right config, and nothing
 * has to be typed. Never fatal — a missing connector is a missing feature, not
 * a broken Nextcloud.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { getServiceExposureRow } from './exposure';
import { getHostGatewayIp } from '../utils/network';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';
const ONLYOFFICE_SERVICE = 'onlyoffice';

/**
 * The occ command lines that install + configure the connector. Run through
 * runNextcloudOccScript, which prepends `set -e`, the `cd`, and the
 * occ-readiness wait. The JWT secret comes in through the environment
 * ($OO_JWT_SECRET), never on the command line, so it stays out of `ps`.
 *
 * Idempotent: `config:app:set` overwrites, and the connector is only installed
 * when absent. A connector install needs the Nextcloud app store (network); if
 * that fails the script exits 0 and the next start retries.
 */
function buildWiringScript(documentServerUrl: string, internalUrl: string, storageUrl: string): string[] {
  return [
    'if ! php occ app:getpath onlyoffice >/dev/null 2>&1; then',
    '  if ! php occ app:install onlyoffice; then',
    '    echo "hlm: could not install the onlyoffice connector (app store unreachable?); skipping"',
    '    exit 0',
    '  fi',
    'fi',
    'php occ app:enable onlyoffice >/dev/null',
    `php occ config:app:set onlyoffice DocumentServerUrl --value "${documentServerUrl}"`,
    `php occ config:app:set onlyoffice DocumentServerInternalUrl --value "${internalUrl}"`,
    `php occ config:app:set onlyoffice StorageUrl --value "${storageUrl}"`,
    // >/dev/null: `config:app:set` echoes the value it stored, and this one is
    // the shared secret — keep it out of the backend log.
    'php occ config:app:set onlyoffice jwt_secret --value "$OO_JWT_SECRET" >/dev/null',
    'php occ config:app:set onlyoffice jwt_header --value "$OO_JWT_HEADER"',
    'echo "hlm: OnlyOffice connector configured"',
  ];
}

export interface NextcloudOnlyOfficePlan {
  documentServerUrl: string;
  internalUrl: string;
  storageUrl: string;
  jwtSecret: string;
  jwtHeader: string;
}

/**
 * Work out the four connector values, or null when the wiring can't/shouldn't
 * run yet (OnlyOffice not in the registry, no JWT secret generated, ports
 * unknown). Exported for the unit test.
 */
export async function buildNextcloudOnlyOfficePlan(): Promise<NextcloudOnlyOfficePlan | null> {
  if (!resolveComposeFile(ONLYOFFICE_SERVICE)?.composeFile) {
    return null;
  }

  const jwtSecret = readAppEnvValue(ONLYOFFICE_SERVICE, 'ONLYOFFICE_JWT_SECRET');
  if (!jwtSecret) {
    // OnlyOffice has never been started through the dashboard, so its
    // generated secret doesn't exist. Wiring now would set a blank secret and
    // every request between the two would fail signature validation.
    return null;
  }
  const jwtHeader = readAppEnvValue(ONLYOFFICE_SERVICE, 'ONLYOFFICE_JWT_HEADER') || 'Authorization';

  const onlyofficePort = getPublishedUpstreamPort(ONLYOFFICE_SERVICE);
  const nextcloudPort = getPublishedUpstreamPort(NEXTCLOUD_SERVICE);
  if (!onlyofficePort || !nextcloudPort) {
    return null;
  }

  const gateway = await getHostGatewayIp();
  const internalUrl = `http://${gateway}:${onlyofficePort}/`;
  const storageUrl = `http://${gateway}:${nextcloudPort}/`;

  const exposure = await getServiceExposureRow(ONLYOFFICE_SERVICE).catch(() => null);
  const publicHost =
    exposure?.enabled && exposure.status === 'provisioned' && exposure.hostname ? exposure.hostname : null;
  const documentServerUrl = publicHost ? `https://${publicHost}/` : internalUrl;

  return { documentServerUrl, internalUrl, storageUrl, jwtSecret, jwtHeader };
}

/**
 * Reconcile Nextcloud's ONLYOFFICE connector on a Nextcloud start. No-op for
 * every other service, and never throws.
 */
export async function reconcileNextcloudOnlyOffice(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }

  const resolved = resolveComposeFile(NEXTCLOUD_SERVICE);
  if (!resolved?.composeFile) {
    return;
  }

  try {
    const plan = await buildNextcloudOnlyOfficePlan();
    if (!plan) {
      logger.info('Skipping the Nextcloud/OnlyOffice wiring: OnlyOffice is not configured yet');
      return;
    }

    const result = await runNextcloudOccScript(
      buildWiringScript(plan.documentServerUrl, plan.internalUrl, plan.storageUrl),
      {
        env: { ...process.env, OO_JWT_SECRET: plan.jwtSecret, OO_JWT_HEADER: plan.jwtHeader },
        passEnv: ['OO_JWT_SECRET', 'OO_JWT_HEADER'],
      }
    );
    // Belt-and-braces: never let the secret reach the log even if a future occ
    // prints it somewhere the script's `>/dev/null` doesn't catch.
    const safeOutput = result.output.split(plan.jwtSecret).join('***').trim();
    logger.info('Nextcloud/OnlyOffice connector reconciled', {
      documentServerUrl: plan.documentServerUrl,
      internalUrl: plan.internalUrl,
      ok: result.ok,
      output: safeOutput || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to wire Nextcloud to OnlyOffice', { error: (error as Error).message });
  }
}

export const __test = { buildWiringScript };
