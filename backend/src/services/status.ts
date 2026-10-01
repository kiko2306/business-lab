/**
 * Service status aggregator
 * Retrieves Docker container state and optional health check status.
 * Returns consolidated service status information.
 */

import { exec } from 'child_process';
import https from 'https';
import http from 'http';
import logger from '../utils/logger';
import { getAllServices, getService, getProjectName, getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getAllExposureRows } from './exposure';
import { baseTagPins, pinnedImages } from './composeOverride';
import { getCachedHostLanIp } from './networkScan';
import { ServiceAdditionalExposure, ServiceExposureRow, ServicePortMapping, ServiceState, ServiceStatusPayload, ServiceStatusResponse } from '../types';

/**
 * Resolve a service's declared `additionalExposures` (services.ts) against
 * their live `service_exposure` rows — pure so it's unit-testable without a
 * database, unlike its caller. Same provisioned/enabled rule as
 * `getExposedHostname`; a row that isn't live yet is left out rather than
 * shown with a null hostname.
 */
export function resolveAdditionalExposureUrls(
  additionalExposures: ServiceAdditionalExposure[] | undefined,
  secondaryRows: ServiceExposureRow[]
): { label: string; hostname: string }[] {
  if (!additionalExposures?.length) return [];
  const rowByKey = new Map(secondaryRows.map((row) => [row.service_name.split(':').pop(), row]));
  return additionalExposures.flatMap((extra) => {
    const row = rowByKey.get(extra.apex ? 'apex' : extra.suffix);
    if (!row || !row.enabled || row.status !== 'provisioned' || !row.hostname) return [];
    return [{ label: extra.label, hostname: row.hostname }];
  });
}

/**
 * The host and database facts a status pass needs, each fetched exactly once
 * however many services the pass covers: one `docker ps -a` and one read of
 * `service_exposure`. A failed exposure read is logged and treated as no rows
 * — exposure is secondary to the container state a status call is really for,
 * so it must not fail the whole payload.
 */
export interface StatusCycle {
  docker: DockerSnapshot | null;
  exposure: ReturnType<typeof groupExposureRows>;
}

export async function buildStatusCycle(): Promise<StatusCycle> {
  const [docker, rows] = await Promise.all([
    dockerPsSnapshot(),
    getAllExposureRows().catch((error: Error) => {
      logger.error('Error loading exposure rows for a status pass', { error: error.message });
      return [] as ServiceExposureRow[];
    }),
  ]);
  return { docker, exposure: groupExposureRows(rows) };
}

/**
 * Collapse a compose project's per-container `docker ps` states into a single
 * service state. Order matters here:
 *  - any container stuck `restarting` → the project is crash-looping (`error`),
 *    not "still starting" — a restart loop never resolves on its own.
 *  - all `running` → `running`.
 *  - some `running`, some still `created` → genuinely mid-boot (`starting`),
 *    e.g. a dependency container hasn't been started yet.
 *  - some `running`, the rest exited → treat as up: one-shot init/migration
 *    containers that ran and exited are normal (e.g. a DB migration step).
 *  - nothing `running` but something `created` → `compose up` created the
 *    container(s) but they never started — a host-port clash or a bad mount —
 *    which is a failure (`error`), not a transient state.
 *  - nothing `running` or `created` → everything exited → `stopped`.
 */
function aggregateContainerState(states: string[]): ServiceState {
  if (!states.length) {
    return 'unknown';
  }

  const has = (state: string) => states.includes(state);
  const running = states.filter((state) => state === 'running').length;

  if (has('restarting')) {
    return 'error';
  }
  if (running === states.length) {
    return 'running';
  }
  if (running > 0) {
    return has('created') ? 'starting' : 'running';
  }
  if (has('created')) {
    return 'error';
  }
  return 'stopped';
}

// Matches one `docker ps --format {{.Ports}}` entry, e.g.
// "0.0.0.0:8080->80/tcp" or "0.0.0.0:80-81->80-81/tcp" (port ranges).
// Unpublished container-only ports (e.g. "5432/tcp", no "->") don't match
// and are skipped, since there's nothing reachable from the host to report.
const PORT_MAPPING_PATTERN = /(?:\S+:)?(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(tcp|udp)/g;

/** One compose project's containers, as a single `docker ps -a` reported them. */
export interface ProjectContainers {
  /** Every container's `{{.State}}`, lowercased, for `aggregateContainerState`. */
  states: string[];
  /**
   * The live published host ports, straight from `docker ps` rather than
   * parsed from the compose file — this way it reflects what's actually bound
   * right now and covers every container in a multi-container project, not
   * just the first `ports:` entry.
   */
  ports: ServicePortMapping[];
}

/** project name -> its containers. A project with no containers is absent. */
export type DockerSnapshot = Map<string, ProjectContainers>;

/**
 * Parse one tab-separated `docker ps -a` listing of *every* container on the
 * host into per-project state. One exec answers all ~50 registry apps: the
 * previous shape ran two `docker ps --filter` execs per app on every status
 * cycle (~100 process spawns every 15 s), which is what made a poll expensive
 * rather than anything Docker itself was doing.
 *
 * Grouping is on the compose project label rather than container names,
 * because compose prefixes/suffixes the names it generates. Ports are taken
 * only from `running` containers — the single `-a` listing also carries
 * stopped ones, whose mapping is not bound to anything on the host.
 */
export function parseDockerPs(stdout: string): DockerSnapshot {
  const snapshot: DockerSnapshot = new Map();
  // Keyed per project so a host port published by two containers of the same
  // project is reported once, as the per-project query used to.
  const portsByProject = new Map<string, Map<string, ServicePortMapping>>();

  for (const line of stdout.split('\n')) {
    const [project, state, portField = ''] = line.split('\t');
    if (!project?.trim() || !state?.trim()) {
      continue;
    }
    const entry = snapshot.get(project) ?? { states: [], ports: [] };
    const lowerState = state.trim().toLowerCase();
    entry.states.push(lowerState);
    snapshot.set(project, entry);

    if (lowerState !== 'running') {
      continue;
    }
    const ports = portsByProject.get(project) ?? new Map<string, ServicePortMapping>();
    portsByProject.set(project, ports);
    PORT_MAPPING_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PORT_MAPPING_PATTERN.exec(portField)) !== null) {
      const [, hostPort, containerPort, protocol] = match;
      const key = `${hostPort}/${protocol}`;
      if (!ports.has(key)) {
        ports.set(key, { hostPort, containerPort, protocol });
      }
    }
  }

  for (const [project, ports] of portsByProject) {
    const entry = snapshot.get(project);
    if (entry) {
      entry.ports = [...ports.values()].sort(
        (a, b) => Number(a.hostPort.split('-')[0]) - Number(b.hostPort.split('-')[0])
      );
    }
  }
  return snapshot;
}

/**
 * List every container on the host, once. Returns null when docker itself
 * can't be reached, so callers can tell "no containers" from "no answer" —
 * the latter leaves a service `unknown` rather than claiming it stopped.
 */
export function dockerPsSnapshot(): Promise<DockerSnapshot | null> {
  return new Promise((resolve) => {
    // Single-quoted for the shell: the Go template's own double quotes around
    // the label name must survive to docker, or it parses `com` as a function
    // and the whole listing fails (verified against a real docker, not just
    // type-checked).
    const format = '{{.Label "com.docker.compose.project"}}\\t{{.State}}\\t{{.Ports}}';
    exec(`docker ps -a --format '${format}'`, (error, stdout) => {
      resolve(error ? null : parseDockerPs(stdout));
    });
  });
}

/**
 * Split one `SELECT * FROM service_exposure` into the primary row per service
 * and the `<service>:<suffix>` secondary rows grouped under their parent — so
 * a whole-registry status cycle reads the table once instead of running two
 * queries per app.
 */
export function groupExposureRows(rows: ServiceExposureRow[]): {
  primary: Map<string, ServiceExposureRow>;
  secondary: Map<string, ServiceExposureRow[]>;
} {
  const primary = new Map<string, ServiceExposureRow>();
  const secondary = new Map<string, ServiceExposureRow[]>();
  for (const row of rows) {
    const separator = row.service_name.indexOf(':');
    if (separator === -1) {
      primary.set(row.service_name, row);
      continue;
    }
    const parent = row.service_name.slice(0, separator);
    const list = secondary.get(parent) ?? [];
    list.push(row);
    secondary.set(parent, list);
  }
  return { primary, secondary };
}

/**
 * The equivalent of getContainerPorts for a service running with
 * `network_mode: host`, whose port is a registry fact rather than something
 * `docker ps` can report. See ServiceDefinition.hostNetworkPort.
 */
export function hostNetworkPortMappings(hostNetworkPort: number): ServicePortMapping[] {
  const port = String(hostNetworkPort);
  return [{ hostPort: port, containerPort: port, protocol: 'tcp' }];
}

/**
 * Health check URLs in the service registry are written from the host's point
 * of view (localhost:CONTAINER_PORT). To make them reachable from the backend
 * container we connect to SERVICE_HEALTH_HOST on the service's *published* host
 * port (which often isn't the container port — Vaultwarden serves :80 but
 * publishes :8222) while still sending the original `localhost:CONTAINER_PORT`
 * as the Host header, so apps that validate Host (gethomepage) still accept it.
 */
function resolveHealthTarget(rawUrl: string, publishedPort: number | null): { url: string; hostHeader?: string } {
  try {
    const url = new URL(rawUrl);
    const hostHeader = url.host; // e.g. "localhost:3000" — what the app expects
    const healthHost = process.env.SERVICE_HEALTH_HOST;
    if (healthHost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      url.hostname = healthHost;
    }
    if (publishedPort) {
      url.port = String(publishedPort);
    }
    return { url: url.toString(), hostHeader };
  } catch {
    return { url: rawUrl };
  }
}

/**
 * A running project that publishes nothing while its compose file declares a
 * host port: docker accepted the container but never programmed the publish.
 *
 * Found live (plan.md §805). Authelia's start lost host port 10100 to a stale
 * `docker-proxy` from its previous container — `failed to bind host port
 * 0.0.0.0:10100/tcp: address already in use` — and docker left the container
 * *running* with no network attachment and no published port. Its healthcheck
 * runs inside the container, so it stayed `healthy`, the dashboard showed it
 * green, and every Authelia-gated app answered 500 for 28 hours with nothing
 * on the Apps page suggesting why.
 *
 * `expectedHostPort` comes from the compose file plus `.env`
 * (`getPublishedUpstreamPort`), `livePorts` from `docker ps`. A host-networked
 * app binds the host directly and publishes nothing by design, so it is
 * exempt; so is an app whose compose file declares no published port.
 */
export function publishedPortMissing(
  expectedHostPort: number | null,
  hostNetworkPort: number | undefined,
  livePorts: ServicePortMapping[]
): boolean {
  if (hostNetworkPort !== undefined || expectedHostPort === null) {
    return false;
  }
  return livePorts.length === 0;
}

/**
 * Whether a running service can actually be reached for an HTTP health probe.
 *
 * The probe connects to the service's *published* host port (`webPort`), or —
 * for a host-networked app — the port it declares (`hostNetworkPort`). A
 * container that publishes nothing and declares neither has no address the
 * backend container can reach: `resolveHealthTarget` would fall back to the
 * container port on `SERVICE_HEALTH_HOST`, where nothing is listening, and the
 * probe would fail — reporting a perfectly healthy app as unhealthy. No
 * registry app hits this today; this stops a future portless one from getting
 * a spurious red (plan.md §170).
 */
export function healthProbeReachable(webPort: number | null, hostNetworkPort: number | undefined): boolean {
  return webPort !== null || hostNetworkPort !== undefined;
}

/**
 * Check service health via HTTP
 */
function checkHealthHttp(target: { url: string; hostHeader?: string }, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = target.url.startsWith('https') ? https : http;
    const timeoutHandle = setTimeout(() => {
      resolve(false);
    }, timeout);

    const options = target.hostHeader ? { timeout, headers: { Host: target.hostHeader } } : { timeout };
    const request = protocol.get(target.url, options, (response) => {
      clearTimeout(timeoutHandle);
      // Consider 2xx and 3xx as healthy
      resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 400);
      response.resume();
    });

    request.on('error', () => {
      clearTimeout(timeoutHandle);
      resolve(false);
    });
  });
}

/**
 * Get status for a single service
 */
export async function getServiceStatus(
  serviceName: string,
  cycle?: StatusCycle
): Promise<ServiceStatusPayload> {
  const service = getService(serviceName);

  if (!service) {
    return {
      name: serviceName,
      state: 'unknown',
      healthy: false,
      error: 'Service not found',
    };
  }

  try {
    const { docker, exposure } = cycle ?? (await buildStatusCycle());
    const projectName = getProjectName(serviceName);
    const containers = projectName ? docker?.get(projectName) : undefined;
    // A missing docker answer leaves the service `unknown`; an answer with no
    // containers for this project means they are genuinely gone.
    const containerState: ServiceState = !docker
      ? 'unknown'
      : aggregateContainerState(containers?.states ?? []);

    // `compose down` removes containers, so an installed app with no containers
    // is stopped rather than unknown. Uninstalled apps stay unknown.
    const resolved = resolveComposeFile(serviceName);
    const installed = Boolean(resolved?.composeFile);
    const state: ServiceState = containerState === 'unknown' && installed ? 'stopped' : containerState;

    const webPort =
      state === 'running' ? getPublishedUpstreamPort(serviceName, service.exposurePortEnvVar) ?? null : null;

    // Without a configured check there's nothing to fail, so a running
    // service is reported healthy; only an actual check can mark it unhealthy.
    let healthy = state === 'running';
    if (service.healthCheck?.enabled && state === 'running') {
      if (service.healthCheck.type === 'http' && service.healthCheck.url) {
        if (healthProbeReachable(webPort, service.hostNetworkPort)) {
          healthy = await checkHealthHttp(
            resolveHealthTarget(service.healthCheck.url, webPort),
            service.healthCheck.timeout
          );
        } else {
          // Nothing to probe against — leave `healthy` at its running default
          // rather than run a check that can only fail.
          logger.warn('Skipping health check: service publishes no reachable host port', { service: serviceName });
        }
      }
    }

    // A host-networked service publishes nothing for `docker ps` to report —
    // it binds the host's interfaces directly — so asking docker would drop it
    // out of the dashboard's running-apps-and-ports table entirely. Report the
    // port it declared instead: from the host's side it is just as reachable,
    // and the container port is the same number by definition.
    const ports =
      state !== 'running'
        ? []
        : service.hostNetworkPort
          ? hostNetworkPortMappings(service.hostNetworkPort)
          : (containers?.ports ?? []);
    // Docker can leave a container running with its publish un-programmed —
    // see publishedPortMissing. Nothing else in the payload notices: the
    // container is up and its own healthcheck passes from inside, while
    // everything that reaches it through the host port is dead.
    if (state === 'running' && publishedPortMissing(webPort, service.hostNetworkPort, ports)) {
      return {
        name: serviceName,
        label: service.label,
        category: service.category,
        state: 'error',
        healthy: false,
        error: `${service.label} is running but published no host port — expected ${webPort}. Docker most likely could not bind it (another process still holds it). Stop and start the app to republish.`,
        lastChecked: new Date(),
      };
    }

    const primaryRow = exposure.primary.get(serviceName);
    const exposedHostname =
      state === 'running' && primaryRow?.enabled && primaryRow.status === 'provisioned'
        ? primaryRow.hostname
        : null;
    const additionalExposureUrls =
      state === 'running'
        ? resolveAdditionalExposureUrls(service.additionalExposures, exposure.secondary.get(serviceName) ?? [])
        : [];
    // Image digests the last self-update (§209) pinned into
    // docker-compose.override.yml (composeOverride.ts). Non-empty means the
    // app is frozen on a specific build until "Unpin" — surfaced so the card
    // can say so.
    const pinned = resolved?.appDir ? [...pinnedImages(resolved.appDir).values()] : [];
    // Version pin baked into docker-compose.yml itself (compat, not
    // self-update) — informational badge only, see baseTagPins' docstring.
    const versionPinned = resolved?.composeFile ? baseTagPins(resolved.composeFile) : [];

    return {
      name: serviceName,
      label: service.label,
      description: service.description,
      icon: service.icon,
      category: service.category,
      state,
      healthy,
      lastChecked: new Date(),
      adminUserManagementSupported: Boolean(service.supportsAdminUserManagement),
      dependsOn: service.dependsOn,
      requires: service.requires,
      pinnedImages: pinned,
      versionPinned,
      ports,
      exposedHostname,
      webPath: service.webPath,
      clientApiPath: service.clientApiPath,
      mobileApps: service.mobileApps,
      webPort,
      lanOnly: service.lanOnly,
      overlayOnly: service.overlayOnly,
      additionalExposureUrls,
    };
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Error getting status for service ${serviceName}`, { error: message });
    return {
      name: serviceName,
      label: service.label,
      category: service.category,
      state: 'error',
      healthy: false,
      error: message,
      lastChecked: new Date(),
    };
  }
}

/**
 * Get status for all services
 */
export async function getAllServiceStatus(): Promise<ServiceStatusResponse> {
  const services = getAllServices();
  const cycle = await buildStatusCycle();
  const statuses = await Promise.all(services.map((service) => getServiceStatus(service.name, cycle)));

  return {
    timestamp: new Date(),
    services: statuses,
    hostLanIp: getCachedHostLanIp(),
    summary: {
      total: statuses.length,
      running: statuses.filter((s) => s.state === 'running').length,
      stopped: statuses.filter((s) => s.state === 'stopped').length,
      error: statuses.filter((s) => s.state === 'error').length,
      starting: statuses.filter((s) => s.state === 'starting').length,
    },
  };
}

export { aggregateContainerState, checkHealthHttp };
