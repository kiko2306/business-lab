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
      .map((host) => host.trim())
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
