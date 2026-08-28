/**
 * Host-port bookkeeping for the per-app configuration UI.
 *
 * When the dashboard offers a `*_PORT` env field, we want to stop the user
 * picking a host port that another service already publishes — `docker
 * compose up` would just fail with "port is already allocated" and the app
 * would sit in the `created` state. The source of truth is `docker ps`: every
 * currently-published host port across every compose project.
 *
 * Non-Docker listeners on the host (e.g. systemd-resolved on :53) aren't
 * visible from inside this container, so they can't be covered here — the
 * start-up log popup surfaces those.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';

// One published mapping from a `docker ps --format {{.Ports}}` entry, e.g.
// "0.0.0.0:8080->80/tcp" or "0.0.0.0:80-81->80-81/tcp" (a range). Same shape
// as PORT_MAPPING_PATTERN in status.ts; unpublished container-only ports have
// no "->" and are skipped.
const HOST_PORT_PATTERN = /(?:\S+:)?(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/(?:tcp|udp)/g;

/** True for env keys that hold a host port, e.g. DOZZLE_PORT, PIHOLE_WEB_PORT. */
export function isPortKey(key: string): boolean {
  return /PORT$/.test(key);
}

export function parseHostPorts(psOutput: string): Set<number> {
  const ports = new Set<number>();
  for (const line of psOutput.split('\n')) {
    HOST_PORT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = HOST_PORT_PATTERN.exec(line)) !== null) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      for (let port = start; port <= end; port++) {
        ports.add(port);
      }
    }
  }
  return ports;
}

/**
 * Host ports currently published by running containers. `projectFilter`
 * restricts it to a single compose project; omit it for every project.
 * Resolves to an empty set if docker can't be reached (e.g. in tests).
 */
function getPublishedHostPorts(projectFilter?: string): Promise<Set<number>> {
  return new Promise((resolve) => {
    const filter = projectFilter
      ? ` --filter "label=com.docker.compose.project=${projectFilter}"`
      : '';
    exec(`docker ps${filter} --format "{{.Ports}}"`, (error, stdout) => {
      if (error) {
        logger.error('Unable to list published host ports', { error: error.message });
        resolve(new Set());
        return;
      }
      resolve(parseHostPorts(stdout));
    });
  });
}

/**
 * Host ports taken by *other* services — every published port minus the ones
 * this service's own project already publishes, so an app that's currently
 * running doesn't flag its own port as a conflict.
 */
export async function getPortsInUseByOtherServices(ownProjectName: string | null): Promise<Set<number>> {
  const [all, own] = await Promise.all([
    getPublishedHostPorts(),
    ownProjectName ? getPublishedHostPorts(ownProjectName) : Promise.resolve(new Set<number>()),
  ]);
  for (const port of own) {
    all.delete(port);
  }
  return all;
}

/**
 * The first free host port at or after `preferred`, skipping anything in
 * `used`. Falls back to `preferred` if nothing in the scanned span is free or
 * the input isn't a usable port number.
 */
export function nextFreePort(preferred: number, used: Set<number>, span = 500): number {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
    return preferred;
  }
  const ceiling = Math.min(65535, preferred + span);
  for (let port = preferred; port <= ceiling; port++) {
    if (!used.has(port)) {
      return port;
    }
  }
  return preferred;
}
