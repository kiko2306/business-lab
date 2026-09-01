/**
 * Per-start env overrides that keep an exposed service's own reverse-proxy
 * knobs — Host-header allow-lists, CSRF trusted origins, "public URL" — in
 * sync with the hostname it's exposed at, without writing to the app's .env.
 *
 * The overrides are merged over process.env for the `docker compose up` that
 * (re)starts the service; Compose prefers the shell environment over the .env
 * file for `${VAR}` substitution, so this wins for the declared keys. Nothing
 * is persisted, so disabling exposure and restarting reverts to the .env /
 * compose defaults on its own.
 */

import fs from 'fs';
import path from 'path';
import { buildExposureHostname, getService } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import { getExposureConfig } from '../utils/exposureSettings';
import { ServiceExposureEnvKeys } from '../types';
import { getServiceExposureRow } from './exposure';

/**
 * Allow-lists are matched against the Host header, so an entry has to be a
 * bare host[:port]. A pasted URL is the obvious way to get that wrong, and it
 * fails silently — as a 400 from the app itself, which the dashboard never
 * sees. Homepage rejected every request for exactly this reason, with
 * HOMEPAGE_ALLOWED_HOSTS holding `https://homepage.<domain>` (§80).
 */
function normaliseHost(value: string): string {
  return value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

/**
 * Pure part: given a service's declared exposure env keys, the hostname it's
 * exposed at, and its current .env values (for merging into allow-lists),
 * produce the { KEY: value } overrides to pass to `docker compose up`.
 */
export function computeExposureEnvOverrides(
  keys: ServiceExposureEnvKeys,
  hostname: string,
  existingValues: Record<string, string>
): Record<string, string> {
  const overrides: Record<string, string> = {};
  const separator = keys.allowedHostsSeparator ?? ',';

  for (const key of keys.url ?? []) {
    overrides[key] = `https://${hostname}`;
  }

  for (const key of keys.host ?? []) {
    overrides[key] = hostname;
  }

  for (const key of keys.allowedHosts ?? []) {
    const splitOn = separator.trim() === '' ? /\s+/ : separator;
    const hosts = (existingValues[key] ?? '')
      .split(splitOn)
      .map((host) => normaliseHost(host))
      .filter(Boolean);
    if (!hosts.includes(hostname)) {
      hosts.push(hostname);
    }
    overrides[key] = hosts.join(separator);
  }

  for (const [key, value] of Object.entries(keys.staticOnExposure ?? {})) {
    overrides[key] = value;
  }

  return overrides;
}

/**
 * Resolve the overrides for a service: no-op unless it declares
 * `exposureEnvKeys`, exposure is enabled for it, and a base domain is
 * configured.
 */
export async function buildExposureEnvOverrides(
  serviceName: string,
  appDir: string
): Promise<Record<string, string>> {
  const exposureEnvKeys = getService(serviceName)?.exposureEnvKeys;
  if (!exposureEnvKeys) {
    return {};
  }

  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow?.enabled) {
    return {};
  }

  const globalConfig = await getExposureConfig();
  if (!globalConfig) {
    return {};
  }

  const hostname = buildExposureHostname(serviceName, globalConfig.baseDomain);
  const envFilePath = path.join(appDir, '.env');
  const existingValues = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};

  return computeExposureEnvOverrides(exposureEnvKeys, hostname, existingValues);
}
