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
import { ensureProxyHost } from './npmClient';
import { ensureIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { ExposureProvisionResult, ServiceExposureInput, ServiceExposureRow } from '../types';

export async function getServiceExposureRow(serviceName: string): Promise<ServiceExposureRow | null> {
  const result = await query<ServiceExposureRow>('SELECT * FROM service_exposure WHERE service_name = $1', [
    serviceName,
  ]);
  return result.rows[0] ?? null;
}

export async function upsertServiceExposureConfig(
  serviceName: string,
  { enabled, upstreamScheme, upstreamHost, upstreamPort, websocket }: ServiceExposureInput
): Promise<ServiceExposureRow> {
  const globalConfig = await getExposureConfig();
  const hostname = globalConfig ? `${serviceName}.${globalConfig.baseDomain}` : null;

  const result = await query<ServiceExposureRow>(
    `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, upstream_host, upstream_port, websocket, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'not_provisioned', NOW())
     ON CONFLICT (service_name)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       hostname = EXCLUDED.hostname,
       upstream_scheme = EXCLUDED.upstream_scheme,
       upstream_host = EXCLUDED.upstream_host,
       upstream_port = EXCLUDED.upstream_port,
       websocket = EXCLUDED.websocket,
       updated_at = NOW()
     RETURNING *`,
    [serviceName, enabled, hostname, upstreamScheme, upstreamHost, upstreamPort, websocket]
  );
  return result.rows[0];
}

interface ProvisioningResult {
  status: string;
  npmHostId?: number | null;
  cfHostnameId?: string | null;
  lastError?: string | null;
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
  const originUrl = `http://nginx-proxy-manager:80`;

  try {
    const npmResult = await ensureProxyHost({
      npmApiUrl: globalConfig.npmApiUrl,
      npmEmail: globalConfig.npmEmail,
      npmPassword: globalConfig.npmPassword,
      hostname,
      forwardScheme: exposureRow.upstream_scheme,
      forwardHost: exposureRow.upstream_host ?? '',
      forwardPort: exposureRow.upstream_port ?? 0,
      websocket: exposureRow.websocket,
    });

    const cfResult = await ensureIngressRoute({
      apiToken: globalConfig.cloudflareApiToken,
      accountId: globalConfig.cloudflareAccountId,
      tunnelId: globalConfig.cloudflareTunnelId,
      hostname,
      originUrl,
    });

    await recordProvisioningResult(serviceName, {
      status: 'provisioned',
      npmHostId: npmResult.id,
      cfHostnameId: hostname,
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
    await recordProvisioningResult(serviceName, { status: 'failed', lastError: message });

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
