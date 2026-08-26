/**
 * First-start public exposure provisioning orchestration (plan.md section 16).
 *
 * When a service with exposure enabled starts successfully, this ensures a
 * matching Nginx Proxy Manager proxy host and Cloudflare Tunnel public
 * hostname route exist, pointing `<service>.<base-domain>` at the service.
 * Provisioning is opt-in per service, idempotent, and never blocks a Docker
 * start that already succeeded — failures are stored and audited instead.
 */

import { query } from '../utils/database';
import { getExposureConfig } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { getPublishedUpstreamPort } from '../config/services';
import { ensureProxyHost } from './npmClient';
import { ensureIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { ExposureProvisionResult, ServiceExposureInput, ServiceExposureRow } from '../types';

// Every exposed service is forwarded to over plain HTTP on the host's
// published port — TLS is terminated by NPM/Cloudflare, not the origin.
const UPSTREAM_SCHEME = 'http';
// Always allowed: harmless for services that never upgrade a connection,
// and required for the ones that do, so there is nothing for the user to
// decide here.
const ALLOW_WEBSOCKET_UPGRADE = true;

export async function getServiceExposureRow(serviceName: string): Promise<ServiceExposureRow | null> {
  const result = await query<ServiceExposureRow>('SELECT * FROM service_exposure WHERE service_name = $1', [
    serviceName,
  ]);
  return result.rows[0] ?? null;
}

export async function upsertServiceExposureConfig(
  serviceName: string,
  { enabled }: ServiceExposureInput
): Promise<ServiceExposureRow> {
  const globalConfig = await getExposureConfig();
  const hostname = globalConfig ? `${serviceName}.${globalConfig.baseDomain}` : null;

  // Upstream scheme/host/port/websocket are derived automatically (see
  // provisionServiceIfEnabled) rather than entered by the user; left
  // unset here and populated on the next successful service start.
  const result = await query<ServiceExposureRow>(
    `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, websocket, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'not_provisioned', NOW())
     ON CONFLICT (service_name)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       hostname = EXCLUDED.hostname,
       updated_at = NOW()
     RETURNING *`,
    [serviceName, enabled, hostname, UPSTREAM_SCHEME, ALLOW_WEBSOCKET_UPGRADE]
  );
  return result.rows[0];
}

interface ProvisioningResult {
  status: string;
  npmHostId?: number | null;
  cfHostnameId?: string | null;
  lastError?: string | null;
}

function getNpmOriginUrl(npmApiUrl: string): string {
  const url = new URL(npmApiUrl);

  // NPM's admin API runs on port 81, while its proxy listener is port 80.
  // A custom API port is retained because it may be a reverse-proxied endpoint.
  if (url.port === '81') {
    url.port = '80';
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

async function recordProvisioningResult(
  serviceName: string,
  { status, npmHostId, cfHostnameId, lastError }: ProvisioningResult
): Promise<void> {
  await query(
    `UPDATE service_exposure
     SET status = $2, npm_host_id = COALESCE($3, npm_host_id), cf_hostname_id = COALESCE($4, cf_hostname_id),
         last_error = $5, updated_at = NOW()
     WHERE service_name = $1`,
    [serviceName, status, npmHostId ?? null, cfHostnameId ?? null, lastError ?? null]
  );
}

async function recordUpstreamConfig(serviceName: string, host: string, port: number): Promise<void> {
  await query(
    `UPDATE service_exposure
     SET upstream_scheme = $2, upstream_host = $3, upstream_port = $4, updated_at = NOW()
     WHERE service_name = $1`,
    [serviceName, UPSTREAM_SCHEME, host, port]
  );
}

/**
 * Provision exposure for a service if it has exposure enabled. Never throws
 * — callers get a result object describing what happened, suitable for
 * merging into a start-service API response as a warning.
 */
export async function provisionServiceIfEnabled(serviceName: string, userId: number): Promise<ExposureProvisionResult> {
  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow || !exposureRow.enabled) {
    return { attempted: false };
  }

  const globalConfig = await getExposureConfig();
  if (!globalConfig) {
    const message = 'Exposure is enabled for this service, but global exposure settings are incomplete.';
    await recordProvisioningResult(serviceName, { status: 'failed', lastError: message });
    return { attempted: true, success: false, warning: message };
  }

  const hostname = `${serviceName}.${globalConfig.baseDomain}`;
  const originUrl = getNpmOriginUrl(globalConfig.npmApiUrl);
  let npmHostId: number | null = null;

  const upstreamPort = getPublishedUpstreamPort(serviceName);
  if (!upstreamPort) {
    const message = `Unable to determine the published port for ${serviceName} from its compose file.`;
    await recordProvisioningResult(serviceName, { status: 'failed', lastError: message });
    return { attempted: true, success: false, warning: message };
  }
  const upstreamHost = await getHostGatewayIp();
  await recordUpstreamConfig(serviceName, upstreamHost, upstreamPort);

  try {
    const npmResult = await ensureProxyHost({
      npmApiUrl: globalConfig.npmApiUrl,
      npmEmail: globalConfig.npmEmail,
      npmPassword: globalConfig.npmPassword,
      hostname,
      expectedHostId: exposureRow.npm_host_id,
      forwardScheme: UPSTREAM_SCHEME,
      forwardHost: upstreamHost,
      forwardPort: upstreamPort,
      websocket: ALLOW_WEBSOCKET_UPGRADE,
    });
    npmHostId = npmResult.id;

    // Persist ownership before the Cloudflare call so a later retry can safely
    // reconcile the host if tunnel provisioning fails after creation.
    await recordProvisioningResult(serviceName, {
      status: 'provisioning',
      npmHostId,
      lastError: null,
    });

    const cfResult = await ensureIngressRoute({
      apiToken: globalConfig.cloudflareApiToken,
      accountId: globalConfig.cloudflareAccountId,
      zoneId: globalConfig.cloudflareZoneId,
      tunnelId: globalConfig.cloudflareTunnelId,
      hostname,
      originUrl,
    });

    await recordProvisioningResult(serviceName, {
      status: 'provisioned',
      npmHostId: npmResult.id,
      cfHostnameId: cfResult.dnsRecordId,
      lastError: null,
    });

    await writeAuditLog({
      userId,
      action: 'exposure_provision',
      resource: serviceName,
      result: 'success',
      metadata: { hostname, npmResult, cfResult },
    }).catch(() => {});

    return { attempted: true, success: true, hostname };
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Exposure provisioning failed for ${serviceName}`, { error: message });
    await recordProvisioningResult(serviceName, { status: 'failed', npmHostId, lastError: message });

    await writeAuditLog({
      userId,
      action: 'exposure_provision',
      resource: serviceName,
      result: 'failure',
      metadata: { hostname, error: message },
    }).catch(() => {});

    return {
      attempted: true,
      success: false,
      warning: `Service started, but exposure provisioning failed: ${message}`,
    };
  }
}
