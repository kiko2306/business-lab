/**
 * First-start public exposure provisioning orchestration (plan.md section 16).
 *
 * When a service with exposure enabled starts successfully, this ensures a
 * matching Nginx Proxy Manager proxy host and Cloudflare Tunnel public
 * hostname route exist, pointing `<service>.<base-domain>` at the service.
 * Provisioning is opt-in per service, idempotent, and never blocks a Docker
 * start that already succeeded — failures are stored and audited instead.
 *
 * A service can also declare `additionalExposures` (see config/services.ts)
 * for secondary hostnames it needs beyond the primary one — e.g. NetBird
 * VPN's dashboard is a static SPA with no server-side proxy for /api, so its
 * management API needs its own directly browser-reachable hostname. Each one
 * gets its own row in service_exposure, keyed as `<service>:<suffix>`, and
 * is provisioned/reconciled the same way as the primary, automatically,
 * whenever the parent service's exposure is enabled — no separate toggle.
 */

import { query } from '../utils/database';
import { getExposureConfig } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { getPublishedUpstreamPort, getService } from '../config/services';
import { ensureProxyHost } from './npmClient';
import { ensureIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { ExposureGlobalConfig, ExposureProvisionResult, HttpError, ServiceExposureInput, ServiceExposureRow } from '../types';

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
  { enabled, autheliaProtected }: ServiceExposureInput
): Promise<ServiceExposureRow> {
  // Some services (e.g. tailscale — a VPN client sidecar with no web UI,
  // no `ports:` in its compose file at all) have nothing a reverse proxy
  // could ever forward to. Reject enabling exposure for those outright,
  // rather than letting it silently fail on the next service start with
  // "unable to determine the published port".
  if (enabled && getPublishedUpstreamPort(serviceName, getService(serviceName)?.exposurePortEnvVar) === null) {
    const error: HttpError = {
      message: `${serviceName} has no published port in its compose file, so it can't be publicly exposed.`,
      statusCode: 400,
    };
    throw error;
  }

  const globalConfig = await getExposureConfig();
  const hostname = globalConfig ? `${serviceName}.${globalConfig.baseDomain}` : null;

  // Upstream scheme/host/port/websocket are derived automatically (see
  // provisionServiceIfEnabled) rather than entered by the user; left
  // unset here and populated on the next successful service start.
  const result = await query<ServiceExposureRow>(
    `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, websocket, authelia_protected, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'not_provisioned', NOW())
     ON CONFLICT (service_name)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       hostname = EXCLUDED.hostname,
       authelia_protected = EXCLUDED.authelia_protected,
       updated_at = NOW()
     RETURNING *`,
    [serviceName, enabled, hostname, UPSTREAM_SCHEME, ALLOW_WEBSOCKET_UPGRADE, Boolean(autheliaProtected)]
  );
  return result.rows[0];
}

/**
 * Idempotently ensure a service_exposure row exists for a secondary
 * exposure's synthetic key (`<service>:<suffix>`), always enabled — it
 * rides along with the parent service's exposure rather than being
 * independently toggleable.
 */
async function ensureSecondaryExposureRow(exposureKey: string, hostname: string): Promise<ServiceExposureRow> {
  const result = await query<ServiceExposureRow>(
    `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, websocket, authelia_protected, status, updated_at)
     VALUES ($1, true, $2, $3, $4, false, 'not_provisioned', NOW())
     ON CONFLICT (service_name)
     DO UPDATE SET hostname = EXCLUDED.hostname, updated_at = NOW()
     RETURNING *`,
    [exposureKey, hostname, UPSTREAM_SCHEME, ALLOW_WEBSOCKET_UPGRADE]
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

// gRPC needs cloudflared to actually reach the origin over TLS+HTTP2/ALPN —
// see ensureGrpcCertificate in npmClient.ts, which gives NPM's grpc hosts a
// self-signed cert on its normal HTTPS listener (443) for exactly this.
// `noTLSVerify`/`originServerName` on the ingress route (see
// provisionHostname) handle the self-signed cert and SNI-based routing.
function getNpmGrpcOriginUrl(npmApiUrl: string): string {
  const url = new URL(npmApiUrl);
  url.protocol = 'https:';
  url.port = '443';
  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

async function recordProvisioningResult(
  exposureKey: string,
  { status, npmHostId, cfHostnameId, lastError }: ProvisioningResult
): Promise<void> {
  await query(
    `UPDATE service_exposure
     SET status = $2, npm_host_id = COALESCE($3, npm_host_id), cf_hostname_id = COALESCE($4, cf_hostname_id),
         last_error = $5, updated_at = NOW()
     WHERE service_name = $1`,
    [exposureKey, status, npmHostId ?? null, cfHostnameId ?? null, lastError ?? null]
  );
}

async function recordUpstreamConfig(exposureKey: string, host: string, port: number): Promise<void> {
  await query(
    `UPDATE service_exposure
     SET upstream_scheme = $2, upstream_host = $3, upstream_port = $4, updated_at = NOW()
     WHERE service_name = $1`,
    [exposureKey, UPSTREAM_SCHEME, host, port]
  );
}

interface ProvisionHostnameOptions {
  exposureKey: string;
  hostname: string;
  upstreamPort: number | null;
  existingNpmHostId: number | null;
  autheliaProtected: boolean;
  grpc: boolean;
  globalConfig: ExposureGlobalConfig;
  originUrl: string;
  userId: number;
  auditResource: string;
}

/**
 * Ensure one NPM proxy host + Cloudflare Tunnel ingress route exist for a
 * single hostname (primary or secondary), recording status/errors against
 * its own service_exposure row. Never throws.
 */
async function provisionHostname({
  exposureKey,
  hostname,
  upstreamPort,
  existingNpmHostId,
  autheliaProtected,
  grpc,
  globalConfig,
  originUrl,
  userId,
  auditResource,
}: ProvisionHostnameOptions): Promise<ExposureProvisionResult> {
  if (!upstreamPort) {
    const message = `Unable to determine the published port for ${hostname} from its compose file.`;
    await recordProvisioningResult(exposureKey, { status: 'failed', lastError: message });
    return { attempted: true, success: false, warning: message };
  }

  const upstreamHost = await getHostGatewayIp();
  await recordUpstreamConfig(exposureKey, upstreamHost, upstreamPort);

  try {
    const npmResult = await ensureProxyHost({
      npmApiUrl: globalConfig.npmApiUrl,
      npmEmail: globalConfig.npmEmail,
      npmPassword: globalConfig.npmPassword,
      hostname,
      expectedHostId: existingNpmHostId,
      forwardScheme: UPSTREAM_SCHEME,
      forwardHost: upstreamHost,
      forwardPort: upstreamPort,
      websocket: ALLOW_WEBSOCKET_UPGRADE,
      autheliaProtected,
      grpc,
    });

    // Persist ownership before the Cloudflare call so a later retry can safely
    // reconcile the host if tunnel provisioning fails after creation.
    await recordProvisioningResult(exposureKey, {
      status: 'provisioning',
      npmHostId: npmResult.id,
      lastError: null,
    });

    const cfResult = await ensureIngressRoute({
      apiToken: globalConfig.cloudflareApiToken,
      accountId: globalConfig.cloudflareAccountId,
      zoneId: globalConfig.cloudflareZoneId,
      tunnelId: globalConfig.cloudflareTunnelId,
      hostname,
      originUrl,
      // Same reasoning as the NPM side (grpc flag) — cloudflared defaults to
      // HTTP/1.1 to the origin regardless of what the origin speaks.
      http2Origin: grpc,
      // originUrl is an IP (getNpmGrpcOriginUrl), fronted by NPM's
      // self-signed cert (ensureGrpcCertificate) — skip verifying it, and
      // send the real hostname as SNI so NPM's vhost routing picks the
      // right proxy host.
      noTLSVerify: grpc,
      originServerName: grpc ? hostname : undefined,
    });

    await recordProvisioningResult(exposureKey, {
      status: 'provisioned',
      npmHostId: npmResult.id,
      cfHostnameId: cfResult.dnsRecordId,
      lastError: null,
    });

    await writeAuditLog({
      userId,
      action: 'exposure_provision',
      resource: auditResource,
      result: 'success',
      metadata: { hostname, npmResult, cfResult },
    }).catch(() => {});

    return { attempted: true, success: true, hostname };
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Exposure provisioning failed for ${hostname}`, { error: message });
    await recordProvisioningResult(exposureKey, { status: 'failed', npmHostId: existingNpmHostId, lastError: message });

    await writeAuditLog({
      userId,
      action: 'exposure_provision',
      resource: auditResource,
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

/**
 * Provision exposure for a service if it has exposure enabled — its primary
 * hostname, plus any additionalExposures it declares. Never throws — callers
 * get a result object describing what happened to the primary hostname
 * (secondary failures are logged/audited but don't change the return value,
 * matching the "never blocks a Docker start" contract), suitable for merging
 * into a start-service API response as a warning.
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
  const serviceDef = getService(serviceName);

  const primaryResult = await provisionHostname({
    exposureKey: serviceName,
    hostname,
    upstreamPort: getPublishedUpstreamPort(serviceName, serviceDef?.exposurePortEnvVar),
    existingNpmHostId: exposureRow.npm_host_id,
    // Authelia can't gate itself — the auth_request call would loop back
    // into its own unauthenticated login page.
    autheliaProtected: serviceName === 'authelia' ? false : exposureRow.authelia_protected,
    grpc: false,
    globalConfig,
    originUrl,
    userId,
    auditResource: serviceName,
  });

  const additionalExposures = serviceDef?.additionalExposures ?? [];
  for (const extra of additionalExposures) {
    const exposureKey = `${serviceName}:${extra.suffix}`;
    const extraHostname = `${serviceName}-${extra.suffix}.${globalConfig.baseDomain}`;
    const extraRow = await ensureSecondaryExposureRow(exposureKey, extraHostname);
    const grpc = Boolean(extra.grpc);

    await provisionHostname({
      exposureKey,
      hostname: extraHostname,
      upstreamPort: getPublishedUpstreamPort(serviceName, extra.portEnvVar),
      existingNpmHostId: extraRow.npm_host_id,
      autheliaProtected: false,
      grpc,
      globalConfig,
      // Cloudflare requires a real TLS+HTTP2/ALPN hop to the origin for
      // gRPC — plain HTTP + http2Origin is a no-op (see
      // getNpmGrpcOriginUrl). Every other exposure stays plain HTTP
      // internally; this is deliberately the one exception.
      originUrl: grpc ? getNpmGrpcOriginUrl(globalConfig.npmApiUrl) : originUrl,
      userId,
      auditResource: `${serviceName} (${extra.label})`,
    }).catch((error: Error) => {
      // provisionHostname itself never throws, but guard anyway — a
      // secondary exposure failure must never surface as a start failure.
      logger.error(`Secondary exposure provisioning failed for ${exposureKey}`, { error: error.message });
    });
  }

  return primaryResult;
}
