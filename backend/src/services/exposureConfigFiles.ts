/**
 * Some apps can't take their reverse-proxy settings from the environment and
 * need a config file touched instead. This runs the same way as
 * buildExposureEnvOverrides — just before `docker compose up` — so the app
 * starts with the right config once exposure is enabled for it.
 *
 * Currently just Home Assistant: it returns "400: Bad Request" for any request
 * arriving through a proxy unless `http.use_x_forwarded_for` is set and the
 * proxy's address is in `http.trusted_proxies`, and there's no env var for
 * either. Two things have to be right:
 *
 *  1. `configuration.yaml` needs a marker-fenced `http:` block (for a fresh
 *     install and for HA's yaml->storage migration).
 *  2. HA 2026.x migrates `http:` into `.storage/http` once and then ignores
 *     the yaml. If that migration captured HA's *default* http config (which
 *     happens when the yaml block is added after HA first booted), HA runs
 *     with no proxy support forever. `.storage/http` has to be reset so HA
 *     re-migrates from the yaml block.
 *
 * Both files are owned by HA's root container and aren't writable by the
 * dashboard's own (non-root) process, so the edit runs inside a throwaway
 * `docker compose run` container using HA's own image + volume mounts.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { getService, resolveComposeFile } from '../config/services';
import { getServiceExposureRow } from './exposure';

const HA_MARKER_BEGIN = '# >>> homelab-management: reverse-proxy exposure >>>';
const HA_MARKER_END = '# <<< homelab-management: reverse-proxy exposure <<<';

// Private ranges a homelab proxy (NPM container, Docker bridge gateway, LAN)
// can realistically originate from. Intentionally broad — this only tells HA
// whose X-Forwarded-For header to trust, not who may connect.
const HA_TRUSTED_PROXIES = ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'];

const HA_HTTP_BLOCK = [
  HA_MARKER_BEGIN,
  '# Added automatically so Home Assistant accepts requests via the reverse',
  '# proxy. Remove this block (and disable exposure) to manage http: yourself.',
  'http:',
  '  use_x_forwarded_for: true',
  '  trusted_proxies:',
  ...HA_TRUSTED_PROXIES.map((cidr) => `    - ${cidr}`),
  HA_MARKER_END,
  '',
].join('\n');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if the file already has a top-level `http:` key the user controls. */
function hasOwnHttpSection(configText: string): boolean {
  const withoutOurs = configText.replace(
    new RegExp(`${escapeRegExp(HA_MARKER_BEGIN)}[\\s\\S]*?${escapeRegExp(HA_MARKER_END)}\\n?`),
    ''
  );
  return /^http:\s*($|[#\s])/m.test(withoutOurs);
}

function run(command: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * The /bin/sh script that runs inside the throwaway HA container. Appends the
 * http: block to /config/configuration.yaml if it's missing (and the user
 * hasn't got their own http:), then moves aside a stale .storage/http so HA
 * re-migrates the block on the start that follows.
 */
function buildHomeAssistantFixScript(): string {
  const blockB64 = Buffer.from(HA_HTTP_BLOCK).toString('base64');
  return [
    'set -e',
    'CFG=/config/configuration.yaml',
    `MARK=${JSON.stringify(HA_MARKER_BEGIN)}`,
    'if [ -f "$CFG" ]; then',
    '  if ! grep -qF "$MARK" "$CFG" && ! grep -qE "^http:([[:space:]]|$)" "$CFG"; then',
    '    printf "\\n" >> "$CFG"',
    `    printf '%s' ${JSON.stringify(blockB64)} | base64 -d >> "$CFG"`,
    '    echo "hlm: appended http: block to configuration.yaml"',
    '  fi',
    'fi',
    'if [ -f /config/.storage/http ]; then',
    // Reset .storage/http only when neither `stable` nor a healthy `pending`
    // already carries use_x_forwarded_for — HA's image has python3, and a
    // heredoc survives the base64 round-trip fine.
    "  RESET=$(python3 <<'PYEOF'",
    'import json',
    'try:',
    '    d = json.load(open("/config/.storage/http"))["data"]',
    '    st = d.get("stable") or {}',
    '    pe = d.get("pending") or {}',
    '    ok = st.get("use_x_forwarded_for") is True or (pe.get("use_x_forwarded_for") is True and not pe.get("error"))',
    '    print("ok" if ok else "reset")',
    'except Exception:',
    '    print("reset")',
    'PYEOF',
    '  )',
    '  if [ "$RESET" = "reset" ]; then',
    '    mv -f /config/.storage/http /config/.storage/http.hlm-superseded 2>/dev/null || rm -f /config/.storage/http',
    '    echo "hlm: reset migrated .storage/http so the yaml http: block re-applies"',
    '  else',
    '    echo "hlm: .storage/http already carries the reverse-proxy config"',
    '  fi',
    'else',
    '  echo "hlm: .storage/http absent; yaml http: block will migrate on boot"',
    'fi',
  ].join('\n');
}

async function reconcileHomeAssistantProxyConfig(serviceName: string): Promise<void> {
  const resolved = resolveComposeFile(serviceName);
  if (!resolved?.composeFile) {
    logger.info('Home Assistant compose file not found; skipping reverse-proxy config');
    return;
  }

  const scriptB64 = Buffer.from(buildHomeAssistantFixScript()).toString('base64');
  // HA's own image + volume mounts, entrypoint overridden so HA never boots —
  // this only edits the bind-mounted /config as root. `--rm` cleans up.
  const command =
    `docker compose -p ${resolved.projectName} -f ${resolved.composeFile} run --rm --no-deps -T ` +
    `--entrypoint /bin/sh home-assistant -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

  const output = await run(command);
  logger.info('Home Assistant reverse-proxy config reconciled', { output: output.trim() || '(no changes)' });
}

/**
 * Touch any config files an exposed service needs before it starts. No-op
 * unless the service declares `exposureConfigFile` and exposure is enabled.
 */
export async function applyExposureConfigFiles(serviceName: string, _appDir: string): Promise<void> {
  if (!getService(serviceName)?.exposureConfigFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(serviceName);
  if (!exposureRow?.enabled) {
    return;
  }

  try {
    if (serviceName === 'home-assistant') {
      await reconcileHomeAssistantProxyConfig(serviceName);
    }
  } catch (error) {
    // Non-fatal: the service can still start, it just won't accept proxied
    // requests until the config is fixed.
    logger.error(`Failed to apply exposure config file for ${serviceName}`, {
      error: (error as Error).message,
    });
  }
}

export const __test = { hasOwnHttpSection, HA_HTTP_BLOCK, HA_MARKER_BEGIN, HA_MARKER_END, buildHomeAssistantFixScript };
