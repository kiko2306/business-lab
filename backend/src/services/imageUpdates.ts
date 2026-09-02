/**
 * "An update is available" without pulling one.
 *
 * The mechanism was settled by experiment (plan.md §82.1), because the obvious
 * routes do not work: `docker ps` has no ImageID field, `docker manifest
 * inspect --verbose` reports the per-platform manifest digest which never
 * matches what the local image records, and buildx is not in this image.
 *
 * What does match, exactly: the registry's `Docker-Content-Digest` header for
 * `repo:tag` against the local `RepoDigests` entry. Both were
 * `sha256:db35bfc6…` for nginx:alpine on this host.
 *
 * Cadence is the real constraint. An anonymous manifest request counts against
 * Docker Hub's 100-per-6h limit per IP and a sweep of the roster is ~50 of
 * them, so results are cached in Postgres and swept once a day — never from a
 * status poll.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { query } from '../utils/database';
import { getAllServices, getProjectName, resolveComposeFile } from '../config/services';
import { parseComposeImages } from './executor';

const DOCKER_HUB_REGISTRY = 'registry-1.docker.io';
const REQUEST_TIMEOUT_MS = 10_000;

// Every manifest media type a registry might answer with. Without these a
// registry returns the v1 manifest, whose digest differs from the one the
// local image recorded, and every image looks out of date.
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export interface ImageRef {
  registry: string;
  repository: string;
  reference: string;
  // True when the ref pins a digest — there is no newer version of a digest,
  // so these are never "out of date".
  pinned: boolean;
}

/**
 * Split `lscr.io/linuxserver/speedtest-tracker:latest` into its parts.
 *
 * The first component is a registry host only if it looks like one — a dot, a
 * port, or literally "localhost". `nginx` and `immich/server` are both Docker
 * Hub, and a single-component name lives under `library/`.
 */
export function parseImageRef(image: string): ImageRef | null {
  if (!image || image.includes(' ')) {
    return null;
  }

  const atIndex = image.indexOf('@');
  if (atIndex !== -1) {
    return { registry: '', repository: image.slice(0, atIndex), reference: image.slice(atIndex + 1), pinned: true };
  }

  let remainder = image;
  let registry = DOCKER_HUB_REGISTRY;
  const firstSlash = remainder.indexOf('/');
  if (firstSlash !== -1) {
    const head = remainder.slice(0, firstSlash);
    if (head.includes('.') || head.includes(':') || head === 'localhost') {
      registry = head;
      remainder = remainder.slice(firstSlash + 1);
    }
  }

  // A colon after the last slash is the tag; one before it is a registry port.
  const lastColon = remainder.lastIndexOf(':');
  const lastSlash = remainder.lastIndexOf('/');
  const reference = lastColon > lastSlash ? remainder.slice(lastColon + 1) : 'latest';
  const repository = lastColon > lastSlash ? remainder.slice(0, lastColon) : remainder;

  if (!repository) {
    return null;
  }

  return {
    registry,
    repository: registry === DOCKER_HUB_REGISTRY && !repository.includes('/') ? `library/${repository}` : repository,
    reference,
    pinned: false,
  };
}

/**
 * Pull realm/service/scope out of a `WWW-Authenticate: Bearer …` challenge.
 * Following the challenge rather than hard-coding auth.docker.io is what makes
 * this work for ghcr.io and lscr.io too.
 */
export function parseAuthChallenge(header: string): { realm: string; params: Record<string, string> } | null {
  const match = /^\s*Bearer\s+(.*)$/i.exec(header);
  if (!match) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const part of match[1].matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) {
    params[part[1]] = part[2];
  }
  if (!params.realm) {
    return null;
  }
  const { realm, ...rest } = params;
  return { realm, params: rest };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The registry's current digest for a tag, or null when it cannot be
 * established — private registry, no network, a 429. Null is "unknown", never
 * "up to date".
 */
export async function fetchRemoteDigest(ref: ImageRef): Promise<string | null> {
  const url = `https://${ref.registry}/v2/${ref.repository}/manifests/${ref.reference}`;
  const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };

  try {
    let response = await fetchWithTimeout(url, { method: 'HEAD', headers });

    if (response.status === 401) {
      const challenge = parseAuthChallenge(response.headers.get('www-authenticate') ?? '');
      if (!challenge) {
        return null;
      }
      const tokenUrl = new URL(challenge.realm);
      for (const [key, value] of Object.entries(challenge.params)) {
        tokenUrl.searchParams.set(key, value);
      }
      // Some registries answer the challenge without echoing a scope.
      if (!tokenUrl.searchParams.get('scope')) {
        tokenUrl.searchParams.set('scope', `repository:${ref.repository}:pull`);
      }
      const tokenResponse = await fetchWithTimeout(tokenUrl.toString());
      if (!tokenResponse.ok) {
        return null;
      }
      const body = (await tokenResponse.json()) as { token?: string; access_token?: string };
      const token = body.token ?? body.access_token;
      if (!token) {
        return null;
      }
      headers.Authorization = `Bearer ${token}`;
      response = await fetchWithTimeout(url, { method: 'HEAD', headers });
    }

    if (!response.ok) {
      return null;
    }
    return response.headers.get('docker-content-digest');
  } catch (error) {
    logger.debug('Registry digest lookup failed', { image: `${ref.repository}:${ref.reference}`, error: (error as Error).message });
    return null;
  }
}

function run(command: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/** The digest the local image was pulled at, for the matching repository. */
export function pickLocalDigest(repoDigests: string[], repository: string): string | null {
  for (const entry of repoDigests) {
    const [repo, digest] = entry.split('@');
    // Docker Hub records these without the library/ prefix it adds on pull.
    if (repo === repository || `library/${repo}` === repository || repo.endsWith(`/${repository}`)) {
      return digest ?? null;
    }
  }
  // A single entry with a name we could not match is still this image's digest.
  // Note this does NOT identify a locally built image: with the containerd
  // store those carry a RepoDigest too — see builtImageNames.
  return repoDigests.length === 1 ? repoDigests[0].split('@')[1] ?? null : null;
}

/**
 * Image names a compose project builds itself, which no registry has ever
 * heard of.
 *
 * "It has no RepoDigests" was the obvious test and it is wrong here: with the
 * containerd image store a locally built image carries one anyway
 * (`pantry-pantry@sha256:…`), so both custom apps reported as permanently
 * unknown until this looked at the compose file instead. A service with a
 * `build:` uses either its declared `image:` or compose's default name,
 * `<project>-<service>`.
 */
export function builtImageNames(config: unknown, projectName: string): Set<string> {
  const names = new Set<string>();
  const services = (config as { services?: Record<string, { build?: unknown; image?: unknown }> })?.services;
  if (!services) {
    return names;
  }
  for (const [key, service] of Object.entries(services)) {
    if (!service?.build) {
      continue;
    }
    names.add(typeof service.image === 'string' ? service.image : `${projectName}-${key}`);
  }
  return names;
}

async function locallyBuiltImages(projectName: string, composeFile: string): Promise<Set<string>> {
  try {
    return builtImageNames(
      JSON.parse(await run(`docker compose -p ${projectName} -f ${composeFile} config --format json`)),
      projectName
    );
  } catch {
    // Worst case the image is checked and reported unknown, which is what
    // happened before this existed — noisy, not wrong.
    return new Set();
  }
}

export interface ServiceUpdateCheck {
  outdated: string[];
  unknown: string[];
}

/**
 * Compare every image in a service's compose project against its registry.
 * Never throws — a service that cannot be checked reports its images as
 * unknown, which the dashboard shows as neither current nor out of date.
 */
export async function checkServiceImages(serviceName: string): Promise<ServiceUpdateCheck> {
  const result: ServiceUpdateCheck = { outdated: [], unknown: [] };
  const resolved = resolveComposeFile(serviceName);
  if (!resolved?.composeFile) {
    return result;
  }

  const projectName = getProjectName(serviceName);
  let images: Map<string, { id: string; name: string }> | null = null;
  try {
    images = parseComposeImages(await run(`docker compose -p ${projectName} -f ${resolved.composeFile} images --format json`));
  } catch {
    return result;
  }
  if (!images) {
    return result;
  }

  const built = await locallyBuiltImages(projectName, resolved.composeFile);

  // One entry per distinct image: a multi-container app often runs two
  // containers on the same one, and asking the registry twice is wasted quota.
  for (const name of new Set([...images.values()].map((image) => image.name))) {
    const ref = parseImageRef(name);
    if (!ref || ref.pinned || built.has(name) || built.has(name.replace(/:latest$/, ''))) {
      continue;
    }

    let repoDigests: string[] = [];
    try {
      repoDigests = JSON.parse(await run(`docker image inspect ${name} --format '{{json .RepoDigests}}'`));
    } catch {
      // Locally built images (the dashboard's own) have no registry to check.
      continue;
    }
    const local = pickLocalDigest(repoDigests, ref.repository);
    if (!local) {
      continue;
    }

    const remote = await fetchRemoteDigest(ref);
    if (!remote) {
      result.unknown.push(name);
    } else if (remote !== local) {
      result.outdated.push(name);
    }
  }

  return result;
}

export async function ensureImageUpdatesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS service_image_updates (
      service_name VARCHAR(100) PRIMARY KEY,
      outdated JSONB NOT NULL DEFAULT '[]'::jsonb,
      unknown JSONB NOT NULL DEFAULT '[]'::jsonb,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function recordImageCheck(serviceName: string, check: ServiceUpdateCheck): Promise<void> {
  await query(
    `INSERT INTO service_image_updates (service_name, outdated, unknown, checked_at)
     VALUES ($1, $2::jsonb, $3::jsonb, NOW())
     ON CONFLICT (service_name) DO UPDATE
       SET outdated = EXCLUDED.outdated, unknown = EXCLUDED.unknown, checked_at = NOW()`,
    [serviceName, JSON.stringify(check.outdated), JSON.stringify(check.unknown)]
  );
}

export interface ImageUpdateRow {
  outdated: string[];
  unknown: string[];
  checkedAt: string;
}

export async function getImageUpdateRows(): Promise<Map<string, ImageUpdateRow>> {
  const result = await query<{ service_name: string; outdated: string[]; unknown: string[]; checked_at: Date }>(
    'SELECT service_name, outdated, unknown, checked_at FROM service_image_updates'
  );
  return new Map(
    result.rows.map((row) => [
      row.service_name,
      { outdated: row.outdated ?? [], unknown: row.unknown ?? [], checkedAt: row.checked_at.toISOString() },
    ])
  );
}

export async function getImageUpdateRow(serviceName: string): Promise<ImageUpdateRow | null> {
  return (await getImageUpdateRows()).get(serviceName) ?? null;
}

// Once a day. Deliberately not hourly: an anonymous manifest request counts
// against Docker Hub's 100-per-6h limit and a sweep is ~50 of them.
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
// A pause between services so a sweep is a trickle rather than a burst.
const BETWEEN_SERVICES_MS = 2_000;

export async function sweepImageUpdates(): Promise<void> {
  const services = getAllServices();
  let outdated = 0;

  for (const service of services) {
    try {
      const check = await checkServiceImages(service.name);
      await recordImageCheck(service.name, check);
      if (check.outdated.length) {
        outdated += 1;
      }
    } catch (error) {
      logger.warn('Image update check failed', { service: service.name, error: (error as Error).message });
    }
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_SERVICES_MS));
  }

  logger.info('Image update sweep finished', { services: services.length, servicesWithUpdates: outdated });
}

export function startImageUpdateSweeper(): void {
  ensureImageUpdatesTable()
    .then(() => sweepImageUpdates())
    .catch((error: Error) => logger.error('Initial image update sweep failed', { error: error.message }));

  setInterval(() => {
    sweepImageUpdates().catch((error: Error) => logger.error('Image update sweep failed', { error: error.message }));
  }, SWEEP_INTERVAL_MS);
}
