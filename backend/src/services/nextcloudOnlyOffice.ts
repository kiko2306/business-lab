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

import { exec } from 'child_process';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { getServiceExposureRow } from './exposure';
import { getHostGatewayIp } from '../utils/network';

const NEXTCLOUD_SERVICE = 'nextcloud';
const ONLYOFFICE_SERVICE = 'onlyoffice';

function run(command: string, env: NodeJS.ProcessEnv, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * The /bin/sh script that runs inside the throwaway Nextcloud container, as
 * www-data. The JWT secret comes in through the environment ($OO_JWT_SECRET),
 * never on the command line, so it stays out of `ps` on the host.
 *
 * Idempotent: `config:app:set` overwrites, and the connector is only installed
 * when absent. A connector install needs the Nextcloud app store (network); if
 * that fails the script exits 0 and the next start retries.
 */
function buildWiringScript(documentServerUrl: string, internalUrl: string, storageUrl: string): string {
  return [
    'set -e',
    'cd /var/www/html',
    // `up -d` returns before Nextcloud has finished its own first-run install,
    // so give occ a little while to answer before giving up (the next start
    // retries anyway).
    'i=0',
    'while ! php occ status >/dev/null 2>&1; do',
    '  i=$((i+1))',
    '  if [ $i -ge 20 ]; then',
    '    echo "hlm: Nextcloud is not ready (occ status failed); skipping OnlyOffice wiring"',
    '    exit 0',
    '  fi',
    '  sleep 3',
    'done',
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
  ].join('\n');
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

    const scriptB64 = Buffer.from(
      buildWiringScript(plan.documentServerUrl, plan.internalUrl, plan.storageUrl)
    ).toString('base64');
    const command =
      `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
      `--user www-data -e OO_JWT_SECRET -e OO_JWT_HEADER ` +
      `--entrypoint /bin/sh nextcloud -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

    const output = await run(command, {
      ...process.env,
      OO_JWT_SECRET: plan.jwtSecret,
      OO_JWT_HEADER: plan.jwtHeader,
    });
    // Belt-and-braces: never let the secret reach the log even if a future occ
    // prints it somewhere the script's `>/dev/null` doesn't catch.
    const safeOutput = output.split(plan.jwtSecret).join('***').trim();
    logger.info('Nextcloud/OnlyOffice connector reconciled', {
      documentServerUrl: plan.documentServerUrl,
      internalUrl: plan.internalUrl,
      output: safeOutput || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to wire Nextcloud to OnlyOffice', { error: (error as Error).message });
  }
}

export const __test = { buildWiringScript };
