/**
 * Some apps can't take their reverse-proxy settings from the environment and
 * need a config file touched instead. This runs the same way as
 * buildExposureEnvOverrides — just before `docker compose up` — so the app
 * starts with the right config once exposure is enabled for it.
 *
 * Currently just Home Assistant: it returns "400: Bad Request" for any
 * request arriving through a proxy unless `http.use_x_forwarded_for` is set
 * and the proxy's address is in `http.trusted_proxies`, and it has no env var
 * for either. The block is appended once, fenced by marker comments, and left
 * in place if exposure is later disabled (harmless — HA still works on the
 * LAN with it) and skipped entirely if the user already declared their own
 * `http:` section.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { getService } from '../config/services';
import { getServiceExposureRow } from './exposure';

const HA_MARKER_BEGIN = '# >>> homelab-management: reverse-proxy exposure >>>';
const HA_MARKER_END = '# <<< homelab-management: reverse-proxy exposure <<<';

// Private ranges a homelab proxy (NPM container, Docker bridge gateway, LAN)
// can realistically originate from. Intentionally broad — this only tells HA
// whose X-Forwarded-For header to trust, not who may connect.
const HA_HTTP_BLOCK = [
  HA_MARKER_BEGIN,
  '# Added automatically so Home Assistant accepts requests via the reverse',
  '# proxy. Remove this block (and disable exposure) to manage http: yourself.',
  'http:',
  '  use_x_forwarded_for: true',
  '  trusted_proxies:',
  '    - 127.0.0.1',
  '    - ::1',
  '    - 10.0.0.0/8',
  '    - 172.16.0.0/12',
  '    - 192.168.0.0/16',
  '    - fc00::/7',
  HA_MARKER_END,
  '',
].join('\n');

/** True if the file already has a top-level `http:` key the user controls. */
function hasOwnHttpSection(configText: string): boolean {
  const withoutOurs = configText.replace(
    new RegExp(`${escapeRegExp(HA_MARKER_BEGIN)}[\\s\\S]*?${escapeRegExp(HA_MARKER_END)}\\n?`),
    ''
  );
  return /^http:\s*($|[#\s])/m.test(withoutOurs);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyHomeAssistantProxyConfig(appDir: string): void {
  const configPath = path.join(appDir, 'data', 'configuration.yaml');
  if (!fs.existsSync(configPath)) {
    // Fresh install: HA writes a default configuration.yaml on first boot, so
    // there's nothing to edit yet. It'll be picked up next start.
    logger.info('Home Assistant configuration.yaml not present yet; skipping proxy config');
    return;
  }

  const current = fs.readFileSync(configPath, 'utf8');
  if (current.includes(HA_MARKER_BEGIN)) {
    return; // already applied
  }
  if (hasOwnHttpSection(current)) {
    logger.info('Home Assistant configuration.yaml already defines http:; leaving it alone');
    return;
  }

  const separator = current.endsWith('\n') || current === '' ? '\n' : '\n\n';
  fs.writeFileSync(configPath, `${current}${separator}${HA_HTTP_BLOCK}`, { mode: 0o644 });
  logger.info('Added reverse-proxy http: block to Home Assistant configuration.yaml');

  resetMigratedHttpStorage(appDir);
}

/**
 * HA 2026.x migrates `http:` out of configuration.yaml into `.storage/http`
 * once (`"yaml_migration_done": true`) and then ignores later yaml edits to
 * keys it has already migrated. An already-onboarded instance therefore never
 * picks up the block we just appended. Move that stale store aside so HA
 * re-migrates from the (now updated) yaml on its next start — it rebuilds the
 * file from yaml + defaults, and `use_x_forwarded_for` / `trusted_proxies`
 * have no UI, so nothing hand-set is lost. Only runs right before
 * `docker compose up`, i.e. with HA stopped.
 */
function resetMigratedHttpStorage(appDir: string): void {
  const storePath = path.join(appDir, 'data', '.storage', 'http');
  if (!fs.existsSync(storePath)) {
    return; // fresh HA — the first boot migrates our yaml cleanly
  }

  try {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
      data?: { yaml_migration_done?: boolean; stable?: Record<string, unknown> };
    };
    const alreadyHasForwarded = store.data?.stable?.use_x_forwarded_for !== undefined;
    if (!store.data?.yaml_migration_done || alreadyHasForwarded) {
      return; // nothing migrated yet, or it already carries our setting
    }
    fs.renameSync(storePath, `${storePath}.superseded-by-homelab-management`);
    logger.info('Reset migrated Home Assistant .storage/http so the yaml http: block re-migrates');
  } catch (error) {
    logger.error('Could not inspect Home Assistant .storage/http', { error: (error as Error).message });
  }
}

/**
 * Touch any config files an exposed service needs before it starts. No-op
 * unless the service declares `exposureConfigFile` and exposure is enabled.
 */
export async function applyExposureConfigFiles(serviceName: string, appDir: string): Promise<void> {
  if (!getService(serviceName)?.exposureConfigFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow?.enabled) {
    return;
  }

  try {
    if (serviceName === 'home-assistant') {
      applyHomeAssistantProxyConfig(appDir);
    }
  } catch (error) {
    // Non-fatal: the service can still start, it just won't accept proxied
    // requests until the config is fixed by hand.
    logger.error(`Failed to apply exposure config file for ${serviceName}`, {
      error: (error as Error).message,
    });
  }
}

export const __test = { hasOwnHttpSection, HA_HTTP_BLOCK, HA_MARKER_BEGIN };
