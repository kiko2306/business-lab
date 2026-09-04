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
 * server-to-server legs are `http://<gateway>:<port>/`.
 *
 * The browser-facing `DocumentServerUrl` is the awkward one (§123.2/§180):
 *  - OnlyOffice exposed  → its public `https://` hostname. This is the normal
 *    case for a public Nextcloud.
 *  - OnlyOffice LAN-only *and* Nextcloud LAN-only → the plain-HTTP gateway URL
 *    works, because Nextcloud is HTTP too (no mixed content).
 *  - OnlyOffice LAN-only but Nextcloud PUBLIC → there is no valid value. The
 *    connector rejects a plain-HTTP `DocumentServerUrl` served into an HTTPS
 *    page ("HTTPS address for ONLYOFFICE Docs is required"), and the gateway
 *    IP isn't reachable from a remote browser anyway. The wiring sets the
 *    internal legs + secret and logs that OnlyOffice must be exposed.
 *
 * Note there is nothing to "restrict to Cloudflare IP ranges" here (§180):
 * with a Cloudflare *Tunnel*, cloudflared connects outbound, so no Cloudflare
 * edge IP ever reaches NPM. The controls that do apply are JWT_ENABLED between
 * the two and not exposing OnlyOffice when the deployment doesn't need it.
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
function buildWiringScript(
  documentServerUrl: string | null,
  internalUrl: string,
  storageUrl: string
): string[] {
  return [
    'if ! php occ app:getpath onlyoffice >/dev/null 2>&1; then',
    '  if ! php occ app:install onlyoffice; then',
    '    echo "hlm: could not install the onlyoffice connector (app store unreachable?); skipping"',
    '    exit 0',
    '  fi',
    'fi',
    'php occ app:enable onlyoffice >/dev/null',
    // Only set the browser URL when there is a valid one — a public Nextcloud
    // with a LAN-only OnlyOffice has none (§180). Leave whatever is there
    // rather than writing a value the connector rejects.
    ...(documentServerUrl
      ? [`php occ config:app:set onlyoffice DocumentServerUrl --value "${documentServerUrl}"`]
      : ['echo "hlm: OnlyOffice is not exposed and Nextcloud is public — DocumentServerUrl left unset; expose OnlyOffice"']),
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
  /**
   * The browser-facing document-server URL, or null when the deployment has
   * no valid one (public Nextcloud + LAN-only OnlyOffice, §180). The other
   * legs and the secret are still wired.
   */
  documentServerUrl: string | null;
  internalUrl: string;
  storageUrl: string;
  jwtSecret: string;
  jwtHeader: string;
}

/** The provisioned public hostname on an exposure row, or null. */
function provisionedHostname(row: Awaited<ReturnType<typeof getServiceExposureRow>>): string | null {
  return row?.enabled && row.status === 'provisioned' && row.hostname ? row.hostname : null;
}

/**
 * Work out the connector values, or null when the wiring can't/shouldn't run
 * yet (OnlyOffice not in the registry, no JWT secret generated, ports
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

  const onlyofficeHost = provisionedHostname(await getServiceExposureRow(ONLYOFFICE_SERVICE).catch(() => null));
  let documentServerUrl: string | null;
  if (onlyofficeHost) {
    documentServerUrl = `https://${onlyofficeHost}/`;
  } else {
    // LAN-only OnlyOffice: the plain-HTTP gateway URL is only a valid
    // DocumentServerUrl when Nextcloud is served over HTTP too — the connector
    // refuses a http:// doc server on an https:// Nextcloud page (§180).
    const nextcloudHost = provisionedHostname(await getServiceExposureRow(NEXTCLOUD_SERVICE).catch(() => null));
    documentServerUrl = nextcloudHost ? null : internalUrl;
  }

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
      documentServerUrl: plan.documentServerUrl ?? '(unset — expose OnlyOffice)',
      internalUrl: plan.internalUrl,
      ok: result.ok,
      output: safeOutput || '(no output)',
    });
    if (!plan.documentServerUrl) {
      logger.warn(
        'OnlyOffice editing will not work: Nextcloud is publicly exposed but OnlyOffice is not. ' +
          'The browser cannot load the editor from a plain-HTTP address. Expose OnlyOffice.'
      );
    }
  } catch (error) {
    logger.error('Failed to wire Nextcloud to OnlyOffice', { error: (error as Error).message });
  }
}

export const __test = { buildWiringScript };
