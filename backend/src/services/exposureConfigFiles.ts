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
  // HA is exposed directly with only its own login (§344), so its brute-force
  // lockout has to be on — ip_ban_enabled defaults false and
  // login_attempts_threshold defaults -1 (never bans).
  '  ip_ban_enabled: true',
  '  login_attempts_threshold: 5',
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

// The reverse-proxy + brute-force-lockout settings HA needs when it's exposed
// directly (§311, §344/§347). Kept as data so the fix script can both write
// the yaml block (fresh install) and merge them straight into .storage/http
// (an established HA that has stopped migrating http: from the yaml).
const HA_HTTP_SETTINGS = {
  use_x_forwarded_for: true,
  trusted_proxies: HA_TRUSTED_PROXIES,
  ip_ban_enabled: true,
  login_attempts_threshold: 5,
} as const;

/**
 * The /bin/sh script that runs inside the throwaway HA container. Two things:
 *
 *  1. `/config/configuration.yaml` carries the current marker-fenced `http:`
 *     block (appended if absent, replaced if stale, left alone if the user
 *     manages their own `http:`) — this is what a *fresh* HA migrates on first
 *     boot.
 *  2. If `/config/.storage/http` already exists, merge the settings straight
 *     into its `data.stable` (and clear a stale `pending`/`error`). An
 *     established HA 2026.x records that it has migrated and then ignores the
 *     yaml `http:` — deleting `.storage/http` does NOT make it re-migrate, it
 *     just falls back to defaults (learned the hard way, §347). Patching the
 *     store in place is the only thing that reaches it.
 */
function buildHomeAssistantFixScript(): string {
  const blockB64 = Buffer.from(HA_HTTP_BLOCK).toString('base64');
  const begin = JSON.stringify(HA_MARKER_BEGIN);
  const end = JSON.stringify(HA_MARKER_END);
  const settingsJson = JSON.stringify(HA_HTTP_SETTINGS);
  return [
    'set -e',
    'CFG=/config/configuration.yaml',
    `export HLM_BLOCK=$(printf '%s' ${JSON.stringify(blockB64)} | base64 -d)`,
    `export HLM_SETTINGS=${JSON.stringify(settingsJson)}`,
    // Reconcile the marker block in configuration.yaml. python3 is in the
    // image; the block comes in via the env so nothing needs escaping.
    "python3 <<'PYEOF'",
    'import io, os, re',
    'cfg = "/config/configuration.yaml"',
    `begin, end = ${begin}, ${end}`,
    'block = os.environ.get("HLM_BLOCK", "")',
    'text = ""',
    'if os.path.exists(cfg):',
    '    text = io.open(cfg, encoding="utf-8").read()',
    'has_own_http = re.search(r"(?m)^http:\\s*($|[#\\s])", re.sub(re.escape(begin) + r"[\\s\\S]*?" + re.escape(end) + r"\\n?", "", text)) is not None',
    'pat = re.compile(re.escape(begin) + r"[\\s\\S]*?" + re.escape(end) + r"\\n?")',
    'if pat.search(text):',
    '    new = pat.sub(block.rstrip("\\n") + "\\n", text, count=1)',
    '    if new != text:',
    '        io.open(cfg, "w", encoding="utf-8").write(new)',
    '        print("hlm: replaced stale http: block in configuration.yaml")',
    '    else:',
    '        print("hlm: configuration.yaml http: block already current")',
    'elif not has_own_http:',
    '    io.open(cfg, "a", encoding="utf-8").write("\\n" + block)',
    '    print("hlm: appended http: block to configuration.yaml")',
    'else:',
    '    print("hlm: user manages http: — left configuration.yaml alone")',
    'PYEOF',
    'if [ -f /config/.storage/http ]; then',
    "  python3 <<'PYEOF'",
    'import json, os',
    'p = "/config/.storage/http"',
    'want = json.loads(os.environ["HLM_SETTINGS"])',
    'try:',
    '    doc = json.load(open(p))',
    'except Exception:',
    '    doc = {"version": 2, "minor_version": 2, "key": "http", "data": {}}',
    'data = doc.setdefault("data", {})',
    'st = data.setdefault("stable", {})',
    'changed = any(st.get(k) != v for k, v in want.items())',
    'st.update(want)',
    "# HA's store loader does raw['pending'] — the key MUST exist (value None",
    '# is fine). A leftover pending block would also keep HA from applying',
    '# stable, so clear it to None rather than delete it (deleting it crashes',
    '# the http integration on boot — learned the hard way, §347).',
    'if data.get("pending") is not None:',
    '    data["pending"] = None',
    '    changed = True',
    'elif "pending" not in data:',
    '    data["pending"] = None',
    'if changed:',
    '    json.dump(doc, open(p, "w"), indent=2)',
    '    print("hlm: merged reverse-proxy + ip_ban settings into .storage/http")',
    'else:',
    '    print("hlm: .storage/http already carries the reverse-proxy config")',
    'PYEOF',
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
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
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
