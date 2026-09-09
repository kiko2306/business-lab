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

import fs from 'fs';
import path from 'path';
import { parseEnvFile } from '../utils/envFile';
import { query } from '../utils/database';
import { EXPOSURE_SETTINGS_KEYS, getExposureConfig, getNpmApiUrl } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { SERVICES, buildExposureHostname, getPublishedUpstreamPort, getService, isAutheliaProtectionRequired } from '../config/services';
import { bootstrapNpmAdminIfDefault, deleteProxyHost, ensureProxyHost, NpmProxyHostPartialCreateError } from './npmClient';
import { ensureIngressRoute, removeIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { ExposureGlobalConfig, ExposureProvisionResult, ServiceExposureRow } from '../types';

// Every exposed service is forwarded to over plain HTTP on the host's
// published port — TLS is terminated by NPM/Cloudflare, not the origin.
const UPSTREAM_SCHEME = 'http';
// Always allowed: harmless for services that never upgrade a connection,
// and required for the ones that do, so there is nothing for the user to
// decide here.
const ALLOW_WEBSOCKET_UPGRADE = true;

/**
 * Whether a service can be publicly exposed through the tunnel, and a
 * human-readable reason when it can't. Three reasons it can't, in priority
 * order:
 *  - no published port in its compose file (tailscale — a VPN sidecar with
 *    no web UI, nothing a reverse proxy could forward to);
 *  - `lanOnly`: publishes a port but speaks a non-HTTP LAN protocol the
 *    tunnel/NPM path can't carry (Samba/SMB on 445) — "can't";
 *  - `overlayOnly`: a policy call, not a protocol one — a sensitive gateway
 *    that *can* be tunnelled but shouldn't be; reach it over the overlay
 *    instead (plan.md §210.3) — "shouldn't".
 *
 * Shared by the write-side guard here and the GET /exposure route, so the
 * two can't drift.
 */
export function getExposability(serviceName: string): { exposable: boolean; reason: string | null } {
  const service = getService(serviceName);
  if (getPublishedUpstreamPort(serviceName, service?.exposurePortEnvVar) === null) {
    return {
      exposable: false,
      reason: `${serviceName} has no published port in its compose file, so it can't be publicly exposed.`,
    };
  }
  if (service?.lanOnly) {
    return { exposable: false, reason: `${serviceName} is a LAN-only service and cannot be exposed through the tunnel.` };
  }
  if (service?.overlayOnly) {
    return {
      exposable: false,
      reason: `${serviceName} is a sensitive gateway — reach it over the NetBird/Tailscale overlay, not the public tunnel.`,
    };
  }
  return { exposable: true, reason: null };
}

export async function getServiceExposureRow(serviceName: string): Promise<ServiceExposureRow | null> {
  const result = await query<ServiceExposureRow>('SELECT * FROM service_exposure WHERE service_name = $1', [
    serviceName,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Auto-exposure (plan.md §331): there is no per-app opt-in — every app
 * `getExposability()` allows *is* exposed, behind Authelia. This keeps the
 * `service_exposure` row in step with that rule; the actual NPM/Cloudflare
 * provisioning is still `provisionServiceIfEnabled`'s job, run straight after.
 *
 *  - exposable → ensure an `enabled` row with the derived hostname exists.
 *  - not exposable, but an `enabled` row exists → tear the live exposure down
 *    and flip the row off (an app that gained `lanOnly`/`overlayOnly`, or lost
 *    its published port — e.g. §239's nginx-proxy-manager).
 *
 * Secondary keys (`<name>:<suffix>`) ride along inside provisionServiceIfEnabled
 * from the parent's `additionalExposures`, so they're skipped here. Idempotent;
 * called on every start and by the reconciler sweep. Never throws.
 */
export async function ensureAutoExposure(serviceName: string, userId: number): Promise<void> {
  if (serviceName.includes(':')) {
    return;
  }
  try {
    const { exposable } = getExposability(serviceName);
    const row = await getServiceExposureRow(serviceName);

    if (exposable) {
      const globalConfig = await getExposureConfig();
      const hostname = globalConfig ? buildExposureHostname(serviceName, globalConfig.baseDomain) : null;
      if (!row || !row.enabled || row.hostname !== hostname) {
        await query(
          `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, websocket, status, updated_at)
           VALUES ($1, true, $2, $3, $4, 'not_provisioned', NOW())
           ON CONFLICT (service_name)
           DO UPDATE SET enabled = true, hostname = EXCLUDED.hostname, updated_at = NOW()`,
          [serviceName, hostname, UPSTREAM_SCHEME, ALLOW_WEBSOCKET_UPGRADE]
        );
      }
      return;
    }

    if (row?.enabled) {
      await deprovisionServiceExposure(serviceName, userId);
      await query(
        `UPDATE service_exposure SET enabled = false, status = 'not_provisioned', last_error = NULL, updated_at = NOW()
         WHERE service_name = $1`,
        [serviceName]
      );
      logger.info(`Auto-exposure: ${serviceName} is no longer exposable — exposure torn down`);
    }
  } catch (error) {
    logger.error(`Auto-exposure reconcile failed for ${serviceName}`, { error: (error as Error).message });
  }
}

/**
 * Idempotently ensure a service_exposure row exists for a secondary
 * exposure's synthetic key (`<service>:<suffix>`), always enabled — it
 * rides along with the parent service's exposure rather than being
 * independently toggleable.
 */
async function ensureSecondaryExposureRow(exposureKey: string, hostname: string): Promise<ServiceExposureRow> {
  const result = await query<ServiceExposureRow>(
    `INSERT INTO service_exposure (service_name, enabled, hostname, upstream_scheme, websocket, status, updated_at)
     VALUES ($1, true, $2, $3, $4, 'not_provisioned', NOW())
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

export function getNpmOriginUrl(npmApiUrl: string): string {
  const url = new URL(npmApiUrl);

  // The tunnel must reach NPM's PROXY listener, not its admin API. Those are
  // two different ports on the same host, and the setting we are handed is
  // the admin one.
  //
  // This used to special-case only port 81 (NPM's stock admin port) and pass
  // anything else through unchanged. That silently broke the moment the admin
  // port was reallocated: every ingress route was repointed at the admin port,
  // so every public hostname served the NPM admin UI instead of its app —
  // one wrong port turning into an estate-wide outage *and* an unintended
  // exposure of the admin panel.
  //
  // Now the proxy port is read from NPM's own env (NPM_HTTP_PORT), which is
  // the same value its compose file publishes, and only falls back to 80.
  //
  // The host is forced to loopback: NPM's proxy listener is bound to
  // 127.0.0.1 (apps/nginx-proxy-manager/compose.yaml) so the LAN cannot reach
  // it with a spoofed Host header and skip Cloudflare (plan.md §180, §279).
  // cloudflared runs on the host, so 127.0.0.1 reaches it; the host portion of
  // npmApiUrl (the bridge gateway, for the admin API from in-container) is
  // discarded here.
  url.hostname = '127.0.0.1';
  url.port = getNpmProxyPort();
  url.pathname = '';
  url.search = '';
  url.hash = '';

  return url.toString().replace(/\/$/, '');
}

/**
 * NPM's public HTTP listener port, from its own .env. Deliberately not
 * inferred from the admin URL: they are independent, and NPM_HTTP_PORT is a
 * documented fixed exception (cloudflared's origin) while the admin port is
 * dynamically allocated.
 */
function getNpmProxyPort(): string {
  try {
    const envPath = path.join(process.cwd(), 'apps', 'nginx-proxy-manager', '.env');
    if (fs.existsSync(envPath)) {
      const port = parseEnvFile(envPath)['NPM_HTTP_PORT'];
      if (port && /^\d+$/.test(port)) return port;
    }
  } catch {
    // Fall through to the default — a missing or unreadable .env must not
    // break provisioning, and 80 is NPM's published default.
  }
  return '80';
}

// gRPC needs cloudflared to actually reach the origin over TLS+HTTP2/ALPN —
// see ensureGrpcCertificate in npmClient.ts, which gives NPM's grpc hosts a
// self-signed cert on its normal HTTPS listener (443) for exactly this.
// `noTLSVerify`/`originServerName` on the ingress route (see
// provisionHostname) handle the self-signed cert and SNI-based routing.
function getNpmGrpcOriginUrl(npmApiUrl: string): string {
  const url = new URL(npmApiUrl);
  url.protocol = 'https:';
  // Loopback, same reason as getNpmOriginUrl (§180, §279): NPM's :443 is bound
  // to 127.0.0.1 now. The self-signed cert is still accepted (noTLSVerify) and
  // the real hostname still goes as SNI via originServerName, so vhost routing
  // is unaffected by the origin host.
  url.hostname = '127.0.0.1';
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

interface DeprovisionHostnameOptions {
  exposureKey: string;
  hostname: string;
  npmHostId: number | null;
  globalConfig: ExposureGlobalConfig;
  userId: number;
  auditResource: string;
  /** Drop the service_exposure row entirely, rather than marking it torn down. */
  deleteRow: boolean;
}

/**
 * Tear down everything provisionHostname created for one hostname: the NPM
 * proxy host, the tunnel ingress rule and its DNS record.
 *
 * Never throws, for the same reason provisionHostname doesn't — teardown runs
 * on paths (disabling exposure, renaming a hostname, reconciling a removed
 * additionalExposure) where failing loudly would block the caller from doing
 * the thing the user actually asked for. Failures are logged and audited.
 *
 * Ordering matters: Cloudflare first, then NPM. If the process dies in
 * between, the hostname no longer resolves and the leftover is a harmless
 * unreferenced NPM host. The reverse order would leave a live DNS record
 * pointing at a vhost that no longer exists.
 */
async function deprovisionHostname({
  exposureKey,
  hostname,
  npmHostId,
  globalConfig,
  userId,
  auditResource,
  deleteRow,
}: DeprovisionHostnameOptions): Promise<void> {
  try {
    await removeIngressRoute({
      apiToken: globalConfig.cloudflareApiToken,
      accountId: globalConfig.cloudflareAccountId,
      zoneId: globalConfig.cloudflareZoneId,
      tunnelId: globalConfig.cloudflareTunnelId,
      hostname,
    });

    if (npmHostId) {
      await deleteProxyHost(globalConfig.npmApiUrl, globalConfig.npmEmail, globalConfig.npmPassword, npmHostId);
    }

    if (deleteRow) {
      await query(`DELETE FROM service_exposure WHERE service_name = $1`, [exposureKey]);
    } else {
      await query(
        `UPDATE service_exposure
         SET status = 'not_provisioned', npm_host_id = NULL, cf_hostname_id = NULL, last_error = NULL, updated_at = NOW()
         WHERE service_name = $1`,
        [exposureKey]
      );
    }

    await writeAuditLog({
      userId,
      action: 'exposure_deprovision',
      resource: auditResource,
      result: 'success',
      metadata: { hostname },
    }).catch(() => {});

    logger.info(`Deprovisioned exposure for ${hostname}`);
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Exposure deprovisioning failed for ${hostname}`, { error: message });
    await recordProvisioningResult(exposureKey, { status: 'failed', npmHostId, lastError: message }).catch(() => {});
    await writeAuditLog({
      userId,
      action: 'exposure_deprovision',
      resource: auditResource,
      result: 'failure',
      metadata: { hostname, error: message },
    }).catch(() => {});
  }
}

/**
 * Tear down every hostname a service owns — its primary plus any
 * additionalExposures — and mark/remove their rows.
 *
 * Called when exposure is switched off for a service. Without this, turning
 * exposure off left the app publicly reachable: the row said "disabled" while
 * the NPM host, tunnel ingress rule and DNS record all still existed and
 * served traffic. That is the bug this function exists to fix, and it is why
 * it runs even when the row is already marked not_provisioned.
 */
export async function deprovisionServiceExposure(serviceName: string, userId: number): Promise<void> {
  const globalConfig = await getExposureConfig();
  if (!globalConfig) {
    logger.warn(`Cannot deprovision ${serviceName}: exposure settings are incomplete`);
    return;
  }

  const rows = await query<ServiceExposureRow>(
    `SELECT * FROM service_exposure WHERE service_name = $1 OR service_name LIKE $2`,
    [serviceName, `${serviceName}:%`]
  );

  for (const row of rows.rows) {
    if (!row.hostname) continue;
    const isSecondary = row.service_name !== serviceName;
    await deprovisionHostname({
      exposureKey: row.service_name,
      hostname: row.hostname,
      npmHostId: row.npm_host_id,
      globalConfig,
      userId,
      auditResource: row.service_name,
      // Secondary rows are synthetic — recreated from the registry on the
      // next provision — so they go away entirely. The primary row carries
      // the user's enabled/authelia choices and must survive.
      deleteRow: isSecondary,
    });
  }
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
    // If NPM created the host but did not confirm it, record the recovered id
    // on the failed row (COALESCE keeps any prior id otherwise). Without this
    // the id is lost and the host is orphaned until deleted by hand in NPM,
    // because ensureProxyHost then refuses to touch a host it has no record of
    // (§99.1).
    const recoveredHostId = error instanceof NpmProxyHostPartialCreateError ? error.hostId : null;
    await recordProvisioningResult(exposureKey, {
      status: 'failed',
      npmHostId: recoveredHostId ?? existingNpmHostId,
      lastError: message,
    });

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
/**
 * Tear down exposure for services that are no longer in the registry.
 *
 * Removing an app used to strand its NPM proxy host and Cloudflare hostname:
 * once the registry entry is gone the dashboard has no page for it, so there
 * is no longer any way to switch exposure off — the route stays live,
 * pointing at a port nothing listens on. Runs once at startup, which is the
 * first moment the code knows an entry has gone.
 *
 * Secondary rows (`<service>:<suffix>`) are matched by their base name, so a
 * removed multi-hostname app takes all of its routes with it.
 */
export async function reconcileRemovedServices(): Promise<void> {
  // A registry that failed to populate would look like "every app was
  // removed"; refuse rather than deprovision the whole stack.
  if (!Object.keys(SERVICES).length) {
    logger.error('Skipping exposure reconciliation: the service registry is empty');
    return;
  }

  const rows = await query<{ service_name: string }>('SELECT service_name FROM service_exposure');
  const orphans = [
    ...new Set(
      rows.rows
        .map((row) => row.service_name.split(':')[0])
        .filter((name) => !SERVICES[name])
    ),
  ];

  for (const name of orphans) {
    logger.info('Removing exposure for a service that is no longer in the registry', { service: name });
    // userId 0: nobody asked for this, the registry changed underneath it.
    await deprovisionServiceExposure(name, 0).catch((error: Error) => {
      logger.error('Could not deprovision a removed service', { service: name, error: error.message });
    });
    // deprovisionServiceExposure keeps the primary row so a re-enable can
    // reuse the user's choices. There is nothing to re-enable here.
    await query('DELETE FROM service_exposure WHERE service_name = $1 OR service_name LIKE $2', [
      name,
      `${name}:%`,
    ]);
    await writeAuditLog({
      userId: null,
      action: 'exposure_disable',
      resource: name,
      result: 'success',
      metadata: { reason: 'service removed from the registry' },
    }).catch(() => {});
  }
}

/**
 * NPM's admin login is the one piece of "global exposure settings" that
 * previously needed a human to type it in once (§0.2's .env.example: "the
 * NPM half can't be [seeded]") — its default credentials have to be changed
 * before the API is usable for anything, and nothing else here knew the new
 * password. But the default credentials are public, documented, fixed
 * values, not a secret to guess, so per §0.3 ("prompt only for what it
 * genuinely cannot obtain") this can run itself: try the default, and if it
 * still works, rotate the password and store both as the dashboard's own
 * Exposure settings — exactly what a human would otherwise type into
 * Settings once. No-op (never throws into the caller) if the defaults don't
 * work, which just means an admin already changed them.
 */
async function ensureNpmAdminBootstrapped(): Promise<void> {
  const npmApiUrl = await getNpmApiUrl();
  let bootstrapped: { email: string; password: string } | null;
  try {
    bootstrapped = await bootstrapNpmAdminIfDefault(npmApiUrl);
  } catch (error) {
    logger.warn('NPM admin bootstrap attempt failed', { error: (error as Error).message });
    return;
  }
  if (!bootstrapped) return;

  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()), ($3, $4, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [EXPOSURE_SETTINGS_KEYS.npmEmail, bootstrapped.email, EXPOSURE_SETTINGS_KEYS.npmPassword, bootstrapped.password]
  );
  logger.info('Rotated Nginx Proxy Manager off its default admin credentials');
}

export async function provisionServiceIfEnabled(serviceName: string, userId: number): Promise<ExposureProvisionResult> {
  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow || !exposureRow.enabled) {
    return { attempted: false };
  }

  let globalConfig = await getExposureConfig();
  if (!globalConfig) {
    await ensureNpmAdminBootstrapped();
    globalConfig = await getExposureConfig();
  }
  if (!globalConfig) {
    const message = 'Exposure is enabled for this service, but global exposure settings are incomplete.';
    await recordProvisioningResult(serviceName, { status: 'failed', lastError: message });
    return { attempted: true, success: false, warning: message };
  }

  const hostname = buildExposureHostname(serviceName, globalConfig.baseDomain);
  const originUrl = getNpmOriginUrl(globalConfig.npmApiUrl);
  const serviceDef = getService(serviceName);

  // A hostname rename (e.g. a service gaining exposureSubdomain) would
  // otherwise strand the old one: ensureProxyHost matches on hostname, so it
  // creates a second NPM host and leaves the first serving traffic.
  if (exposureRow.hostname && exposureRow.hostname !== hostname) {
    await deprovisionHostname({
      exposureKey: serviceName,
      hostname: exposureRow.hostname,
      npmHostId: exposureRow.npm_host_id,
      globalConfig,
      userId,
      auditResource: `${serviceName} (renamed from ${exposureRow.hostname})`,
      deleteRow: false,
    });
    exposureRow.npm_host_id = null;
  }

  const primaryResult = await provisionHostname({
    exposureKey: serviceName,
    hostname,
    upstreamPort: getPublishedUpstreamPort(serviceName, serviceDef?.exposurePortEnvVar),
    existingNpmHostId: exposureRow.npm_host_id,
    autheliaProtected: isAutheliaProtectionRequired(serviceName),
    grpc: false,
    globalConfig,
    originUrl,
    userId,
    auditResource: serviceName,
  });

  const additionalExposures = serviceDef?.additionalExposures ?? [];
  for (const extra of additionalExposures) {
    // `apex` entries key as `<service>:apex` and resolve to the bare base
    // domain rather than a labelled subdomain (plan.md §111).
    const exposureKey = `${serviceName}:${extra.apex ? 'apex' : extra.suffix}`;
    const extraHostname = buildExposureHostname(serviceName, globalConfig.baseDomain, extra.suffix, {
      apex: extra.apex,
    });
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

  // Reconcile secondaries the registry no longer declares — e.g. NetBird's
  // signal hostname, dropped when signal moved off the tunnel. Their rows and
  // live resources would otherwise outlive the definition that created them.
  const declaredKeys = new Set(
    additionalExposures.map((extra) => `${serviceName}:${extra.apex ? 'apex' : extra.suffix}`)
  );
  const existingSecondaries = await query<ServiceExposureRow>(
    `SELECT * FROM service_exposure WHERE service_name LIKE $1`,
    [`${serviceName}:%`]
  );
  for (const row of existingSecondaries.rows) {
    if (declaredKeys.has(row.service_name) || !row.hostname) continue;
    logger.info(`Removing exposure for ${row.service_name}, no longer declared in the service registry`);
    await deprovisionHostname({
      exposureKey: row.service_name,
      hostname: row.hostname,
      npmHostId: row.npm_host_id,
      globalConfig,
      userId,
      auditResource: `${row.service_name} (removed from registry)`,
      deleteRow: true,
    });
  }

  return primaryResult;
}
