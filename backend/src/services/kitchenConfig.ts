/**
 * The Kitchen switcher is a static page that embeds its sibling apps in
 * iframes, so it has to know their URLs — which depend on whether each one is
 * exposed, and on the ports the allocator handed out. It used to guess:
 * hard-coded LAN ports (stale since the renumbering — 9925/8014 point at
 * nothing now) and a hostname pattern assembled from its own address.
 *
 * The dashboard already knows the real answers, so it writes them. This runs
 * from startService the same way as buildExposureEnvOverrides and
 * applyExposureConfigFiles: just before `docker compose up`, so the page is
 * correct from the moment it starts, with no field for anyone to fill in.
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, getService } from '../config/services';
import { getServiceExposureRow } from './exposure';

export const KITCHEN_SERVICE = 'kitchen-switcher';

// The apps the switcher embeds, in tab order.
export const KITCHEN_APPS = ['mealie', 'pantry'] as const;

export interface KitchenTargetConfig {
  label: string;
  // Public URL when the app is exposed and provisioned, else null.
  publicUrl: string | null;
  // Published host port, so the page can build a LAN URL against whatever
  // host it was itself loaded from. Null when the compose file publishes none.
  port: number | null;
}

export type KitchenConfig = Record<string, KitchenTargetConfig>;

export async function buildKitchenConfig(): Promise<KitchenConfig> {
  const config: KitchenConfig = {};

  for (const name of KITCHEN_APPS) {
    const service = getService(name);
    if (!service) {
      // A dropped app is simply absent from the file; the page renders the
      // tabs the file gives it, so nothing has to change in two places.
      continue;
    }

    const row = await getServiceExposureRow(name).catch(() => null);
    const exposed = row?.enabled && row.status === 'provisioned' && row.hostname ? row.hostname : null;

    config[name] = {
      label: service.label ?? name,
      publicUrl: exposed ? `https://${exposed}` : null,
      port: getPublishedUpstreamPort(name, service.exposurePortEnvVar),
    };
  }

  return config;
}

/**
 * Write html/config.json for the switcher. Best-effort: a failure here leaves
 * the page on its built-in fallbacks rather than failing the start.
 */
export async function applyKitchenConfig(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== KITCHEN_SERVICE) {
    return;
  }

  try {
    const config = await buildKitchenConfig();
    const target = path.join(appDir, 'html', 'config.json');
    await fs.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    logger.info('Wrote the Kitchen switcher config', { apps: Object.keys(config) });
  } catch (error) {
    logger.warn('Could not write the Kitchen switcher config', { error: (error as Error).message });
  }
}
