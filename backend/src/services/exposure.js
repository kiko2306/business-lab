'use strict';

/**
 * First-start public exposure provisioning orchestration (plan.md section 16).
 *
 * When a service with exposure enabled starts successfully, this ensures a
 * matching Nginx Proxy Manager proxy host and Cloudflare Tunnel public
 * hostname route exist, pointing `<service>.<base-domain>` at the service.
 * Provisioning is opt-in per service, idempotent, and never blocks a Docker
 * start that already succeeded — failures are stored and audited instead.
 */

const { query } = require('../utils/database');
const { getExposureConfig } = require('../utils/exposureSettings');
const { ensureProxyHost } = require('./npmClient');
const { ensureIngressRoute } = require('./cloudflareTunnelClient');
const { writeAuditLog } = require('../utils/audit');
const logger = require('../utils/logger');

async function getServiceExposureRow(serviceName) {
  const result = await query('SELECT * FROM service_exposure WHERE service_name = $1', [serviceName]);
  return result.rows[0] ?? null;
}

async function upsertServiceExposureConfig(serviceName, { enabled, upstreamScheme, upstreamHost, upstreamPort, websocket }) {
  const globalConfig = await getExposureConfig();
  const hostname = globalConfig ? `${serviceName}.${globalConfig.baseDomain}` : null;

  const result = await query(
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

async function recordProvisioningResult(serviceName, { status, npmHostId, cfHostnameId, lastError }) {
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
async function provisionServiceIfEnabled(serviceName, userId) {
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
      forwardHost: exposureRow.upstream_host,
      forwardPort: exposureRow.upstream_port,
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
    logger.error(`Exposure provisioning failed for ${serviceName}`, { error: error.message });
    await recordProvisioningResult(serviceName, { status: 'failed', lastError: error.message });

    await writeAuditLog({
      userId,
      action: 'exposure_provision',
      resource: serviceName,
      result: 'failure',
      metadata: { hostname, error: error.message },
    }).catch(() => {});

    return {
      attempted: true,
      success: false,
      warning: `Service started, but exposure provisioning failed: ${error.message}`,
    };
  }
}

module.exports = {
  getServiceExposureRow,
  upsertServiceExposureConfig,
  provisionServiceIfEnabled,
};
