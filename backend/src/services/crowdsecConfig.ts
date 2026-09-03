/**
 * CrowdSec (apps/crowdsec/) can't be driven purely from environment variables
 * the way the other apps here are, so the two files it needs are rendered from
 * stored settings right before `docker compose up` — the same point in
 * startService as buildExposureEnvOverrides / applyExposureConfigFiles. Nothing
 * to hand-edit.
 *
 *  1. config/cloudflare-worker-bouncer.yaml — crowdsecurity/cloudflare-worker-
 *     bouncer only reads a YAML file. It needs the Cloudflare account/zone/token
 *     the dashboard already stores for tunnel management (utils/exposureSettings)
 *     plus the local-API key from this app's own .env (CROWDSEC_BOUNCER_KEY,
 *     which the compose file also feeds to the agent as BOUNCER_KEY_cloudflare
 *     so the two ends share a secret). The bouncer then deploys a Cloudflare
 *     Worker + KV + zone routes that block flagged IPs at the edge.
 *
 *  2. Nginx Proxy Manager's data/.../nginx/custom/http_top.conf — trusts
 *     Cloudflare's edge ranges for nginx's real_ip module via `set_real_ip_from`,
 *     an http{}-scope directive, i.e. NPM's custom-config drop-in. Best-effort:
 *     if the backend can't write into NPM's data dir it logs how to add it by
 *     hand. Deliberately does NOT set `real_ip_header` / `real_ip_recursive` —
 *     NPM's own nginx.conf already declares both unconditionally, and a
 *     duplicate declaration fails nginx's config test, which breaks every
 *     future proxy-host create/update/delete until someone notices (§99).
 *
 *     This block turns out to be belt-and-braces (§110): NPM's own nginx.conf
 *     already trusts all of RFC1918 (`set_real_ip_from 10.0.0.0/8` … "Includes
 *     Docker subnet") with `real_ip_recursive on`, and `cloudflared` runs on
 *     the host and reaches NPM's published port, so the connecting peer is the
 *     docker bridge gateway (10.201.0.1) — already trusted. The access logs
 *     carry the real client IP (verified: tunnelled traffic logs public IPv6,
 *     LAN traffic logs 192.168.x). Kept anyway in case NPM ever tightens its
 *     defaults.
 *
 *  3. The CrowdSec Lua bouncer inside NPM — enforcement (§119). Two more
 *     rendered pieces, both behind the `crowdsec_enforce_npm` setting:
 *     `crowdsec-bouncer/crowdsec-nginx-bouncer.conf` (holds the LAPI key) and
 *     a second marker-fenced block in the same `http_top.conf`, which loads
 *     the vendored library and runs a per-request check against CrowdSec's
 *     decision stream. Off = neither is present and nginx runs no Lua at all.
 *
 *     Both blocks share one read-modify-write of `http_top.conf`, followed by
 *     starting nginx for real in a throwaway container built from NPM's own
 *     image and volumes. That check is not optional politeness: a missing
 *     bouncer .conf or an unresolvable `require` doesn't degrade enforcement,
 *     it stops nginx from starting — and NPM refusing to start takes every
 *     proxied site down with it (§99, §119.4). A failed check rolls the file
 *     back untouched. See testNpmConfig for why `nginx -t` alone would miss
 *     exactly the failures this feature can cause.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../utils/logger';
import { getExposureConfig } from '../utils/exposureSettings';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import { getAlertNotifyConfig } from '../utils/alertNotify';
import { CROWDSEC_ALERT_WEBHOOK_PATH } from './n8nWorkflows';

const NPM_SERVICE = 'nginx-proxy-manager';
const BOUNCER_CONFIG_RELATIVE = path.join('config', 'cloudflare-worker-bouncer.yaml');
const BOUNCER_KEY_ENV = 'CROWDSEC_BOUNCER_KEY';

const PROFILES_CONFIG_RELATIVE = path.join('config', 'profiles.yaml');
const HTTP_NOTIFY_CONFIG_RELATIVE = path.join('config', 'notifications', 'http.yaml');
// CrowdSec POSTs alerts to the n8n relay workflow (§118.3/§118.4), which
// dedupes/formats and forwards to ntfy. The crowdsec container gets
// `host.docker.internal:host-gateway` as an extra_host (see its compose
// file), so it can reach n8n's published port across compose-project bridges.
const N8N_SERVICE = 'n8n';
const N8N_DEFAULT_PORT = 10240;

const NPM_REALIP_MARKER_BEGIN = '# >>> homelab-management: crowdsec real-ip >>>';
const NPM_REALIP_MARKER_END = '# <<< homelab-management: crowdsec real-ip <<<';

// The enforcement block (§119) is fenced separately from the real-IP one so
// each can be added, replaced or removed without disturbing the other — they
// are controlled by different things (real-IP is unconditional, enforcement
// follows a setting) and share only the file they live in.
const NPM_BOUNCER_MARKER_BEGIN = '# >>> homelab-management: crowdsec bouncer >>>';
const NPM_BOUNCER_MARKER_END = '# <<< homelab-management: crowdsec bouncer <<<';

/** LAPI key for the NPM bouncer, in apps/crowdsec/.env. */
const NPM_BOUNCER_KEY_ENV = 'CROWDSEC_NGINX_BOUNCER_KEY';
/** Vendored library + rendered config, under apps/nginx-proxy-manager/. */
const NPM_BOUNCER_DIR = 'crowdsec-bouncer';
const NPM_BOUNCER_CONF_FILE = 'crowdsec-nginx-bouncer.conf';
// Where NPM's compose file mounts that directory. Everything the Lua code
// reads is addressed through it, so the two must move together.
const NPM_BOUNCER_MOUNT = '/crowdsec';
// Reported to LAPI, and what `cscli bouncers list` shows. The version is the
// vendored lua-cs-bouncer tag — see crowdsec-bouncer/README.md.
const NPM_BOUNCER_USER_AGENT = 'crowdsec-nginx-bouncer/v1.0.18';

// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). Stable
// for years; refresh if edge requests start showing up un-rewritten in logs.
const CLOUDFLARE_IP_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

function run(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Config for crowdsecurity/cloudflare-worker-bouncer — it deploys a Cloudflare
// Worker + KV namespace + zone routes that block IPs CrowdSec has flagged
// (the legacy IP-list + Firewall-Rules bouncer stopped working when Cloudflare
// froze that API). `actions: ['ban']` = drop, no captcha, so no Turnstile.
function buildBouncerConfig(opts: { lapiKey: string; accountId: string; zoneId: string; apiToken: string }) {
  return {
    crowdsec_config: {
      lapi_url: 'http://crowdsec:8080/',
      lapi_key: opts.lapiKey,
      update_frequency: '10s',
      include_scenarios_containing: [],
      exclude_scenarios_containing: [],
      only_include_decisions_from: [],
      key_path: '',
      cert_path: '',
      ca_cert_path: '',
    },
    cloudflare_config: {
      accounts: [
        {
          id: opts.accountId,
          token: opts.apiToken,
          account_name: '',
          ip_list_prefix: 'crowdsec',
          default_action: 'ban',
          total_ip_list_capacity: 10000,
          zones: [
            {
              zone_id: opts.zoneId,
              actions: ['ban'],
              default_action: 'ban',
              routes_to_protect: [],
              turnstile: { enabled: false },
            },
          ],
        },
      ],
    },
    log_mode: 'stdout',
    log_level: 'info',
    prometheus: { enabled: false, listen_addr: '127.0.0.1', listen_port: '2112' },
  };
}

/** One generated secret out of an app's .env, or null while it's a placeholder. */
function readEnvSecret(appDir: string, key: string): string | null {
  const envPath = path.join(appDir, '.env');
  if (!fs.existsSync(envPath)) {
    return null;
  }
  const value = parseEnvFile(envPath)[key]?.trim();
  return value && value !== 'change-me' ? value : null;
}

function writeIfChanged(target: string, body: string, mode: number): boolean {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (current === body) {
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, { mode });
  return true;
}

/**
 * Render config/cloudflare-worker-bouncer.yaml. Always writes a file (so the compose
 * bind mount never resolves to an auto-created directory); when a setting is
 * missing the file is a self-describing placeholder that makes the bouncer
 * fail loudly rather than silently mis-start.
 */
function writeBouncerConfig(appDir: string, lapiKey: string | null, exposure: Awaited<ReturnType<typeof getExposureConfig>>): void {
  const ready = Boolean(lapiKey && exposure);
  const header = ready
    ? '# Auto-generated by homelab-management from stored settings on each CrowdSec\n# start. Do not edit — changes are overwritten.\n'
    : '# Auto-generated placeholder — CrowdSec is not fully configured yet:\n' +
      (lapiKey ? '' : '#   - CROWDSEC_BOUNCER_KEY: open the CrowdSec config in the dashboard and Save.\n') +
      (exposure ? '' : '#   - Exposure settings: Settings -> Exposure (base domain, Cloudflare account/zone/token).\n') +
      '# Set those, then restart CrowdSec; this file regenerates automatically.\n';

  const body =
    header +
    yaml.dump(
      buildBouncerConfig({
        lapiKey: lapiKey ?? '',
        accountId: exposure?.cloudflareAccountId ?? '',
        zoneId: exposure?.cloudflareZoneId ?? '',
        apiToken: exposure?.cloudflareApiToken ?? '',
      }),
      { lineWidth: -1 }
    );

  if (writeIfChanged(path.join(appDir, BOUNCER_CONFIG_RELATIVE), body, 0o600)) {
    logger.info(`CrowdSec: rendered cloudflare-worker-bouncer.yaml (${ready ? 'configured' : 'placeholder — missing settings'})`);
  }
}

function buildNpmRealIpBlock(): string {
  return [
    NPM_REALIP_MARKER_BEGIN,
    "# Trust Cloudflare's edge ranges for the real_ip module. Not real_ip_header",
    "# or real_ip_recursive here: NPM's own nginx.conf already declares both",
    '# unconditionally (real_ip_header X-Real-IP;), and nginx refuses to start',
    "# with a directive declared twice, which silently breaks every future",
    '# proxy-host create/update/delete until fixed (§99).',
    ...CLOUDFLARE_IP_RANGES.map((range) => `set_real_ip_from ${range};`),
    NPM_REALIP_MARKER_END,
    '',
  ].join('\n');
}

/**
 * The nginx side of the Lua bouncer: everything that has to live in http{}.
 * Kept as close to upstream's `crowdsec_nginx.conf` as possible so that
 * comparing against a newer lua-cs-bouncer release is a readable diff — the
 * only deliberate changes are the two paths (this stack mounts the library at
 * /crowdsec rather than installing it system-wide) and renaming upstream's
 * `$unix` variable, which is far too generic to introduce into someone else's
 * nginx.conf.
 */
function buildNpmBouncerBlock(): string {
  return [
    NPM_BOUNCER_MARKER_BEGIN,
    '# CrowdSec enforcement (§119): a per-request check of the client IP against',
    "# CrowdSec's decision stream, 403 for banned IPs. Rendered only while",
    '# "Enforce CrowdSec bans at NPM" is on — with it off there is no Lua here at',
    '# all. Do not edit: rewritten on every CrowdSec start.',
    '#',
    '# This is http-scope, so it covers NPM\'s own admin UI on :81 as well as the',
    '# proxied sites. That is intended — a banned IP has no business at either —',
    '# but it does mean an admin whose IP gets banned waits out the 4h with the',
    '# rest of them, or clears it from the dashboard.',
    `lua_package_path '${NPM_BOUNCER_MOUNT}/lua/?.lua;;';`,
    '# 50m holds a large decision list comfortably; the bouncer logs when full.',
    'lua_shared_dict crowdsec_cache 50m;',
    'init_by_lua_block {',
    '        cs = require "crowdsec"',
    `        local ok, err = cs.init("${NPM_BOUNCER_MOUNT}/${NPM_BOUNCER_CONF_FILE}", "${NPM_BOUNCER_USER_AGENT}")`,
    '        if ok == nil then',
    '                ngx.log(ngx.ERR, "[Crowdsec] " .. err)',
    '                error()',
    '        end',
    '        ngx.log(ngx.ALERT, "[Crowdsec] Initialisation done")',
    '}',
    '',
    '# Requests nginx serves over a unix socket have no meaningful remote_addr.',
    'map $server_addr $crowdsec_unix {',
    '        default  0;',
    '        "~unix:" 1;',
    '}',
    '',
    'init_worker_by_lua_block {',
    '        cs = require "crowdsec"',
    '        local mode = cs.get_mode()',
    '        if string.lower(mode) == "stream" then',
    '                cs.SetupStream()',
    '        end',
    '        if ngx.worker.id() == 0 then',
    '                cs.SetupMetrics()',
    '        end',
    '}',
    '',
    'access_by_lua_block {',
    '        local cs = require "crowdsec"',
    '        if ngx.var.crowdsec_unix == "1" then',
    '                ngx.log(ngx.DEBUG, "[Crowdsec] Unix socket request, ignoring")',
    '        else',
    '                -- remote_addr, not the raw peer: nginx\'s real_ip module has',
    '                -- already rewritten it to the client Cloudflare saw (§110.2).',
    '                cs.Allow(ngx.var.remote_addr)',
    '        end',
    '}',
    NPM_BOUNCER_MARKER_END,
    '',
  ].join('\n');
}

/**
 * The bouncer's own config file. See crowdsec-nginx-bouncer.conf.example for
 * what each key is doing and, more importantly, for the two that are
 * deliberately absent (`FALLBACK_REMEDIATION`, the captcha keys).
 */
function buildNpmBouncerConf(apiKey: string): string {
  return `# Auto-generated by homelab-management on each CrowdSec start (§119).
# Do not edit — toggle "Enforce CrowdSec bans at NPM" in the dashboard instead.
# Mirrors crowdsec-nginx-bouncer.conf.example, which documents every key.
ENABLED=true
API_URL=http://crowdsec:8080
API_KEY=${apiKey}
MODE=stream
UPDATE_FREQUENCY=10
REQUEST_TIMEOUT=1000
BOUNCING_ON_TYPE=ban
BAN_TEMPLATE_PATH=${NPM_BOUNCER_MOUNT}/templates/ban.html
CAPTCHA_PROVIDER=
SECRET_KEY=
SITE_KEY=
APPSEC_URL=
`;
}

/**
 * One canonical form for a config file we edit in two places: no leading blank
 * lines, exactly one blank line between blocks, exactly one trailing newline.
 *
 * Without this the two edits below disagree about spacing — appending a block
 * separates it with a blank line, replacing one in place doesn't — so the file
 * keeps "changing" on every render, and each phantom change costs a rewrite
 * and a config test. Normalising both to the same shape is what makes the
 * whole render idempotent.
 */
function normaliseConf(text: string): string {
  const body = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
  return body ? `${body}\n` : '';
}

/**
 * Insert, replace or (with `block: null`) remove one marker-fenced block in a
 * config file, leaving everything around it — including the other block, and
 * anything an operator added by hand — in place.
 */
function replaceMarkedBlock(existing: string, begin: string, end: string, block: string | null): string {
  const fence = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);

  if (fence.test(existing)) {
    return normaliseConf(existing.replace(fence, block ? block.trimEnd() : ''));
  }
  if (!block) {
    return existing;
  }
  const before = existing.trimEnd();
  return normaliseConf(before ? `${before}\n\n${block.trimEnd()}` : block.trimEnd());
}

/**
 * NPM's compose file, as the source of the image and bind mounts a config test
 * has to reproduce. Reading them rather than hardcoding means the test keeps
 * matching the real container when a mount is added to that file — which is
 * exactly how the bouncer's own /crowdsec mount arrived.
 */
function readNpmComposeRuntime(appDir: string, composeFile: string): { image: string; mounts: string[] } | null {
  try {
    const doc = yaml.load(fs.readFileSync(composeFile, 'utf8')) as {
      services?: Record<string, { image?: string; volumes?: string[] }>;
    };
    const service = doc?.services?.[NPM_SERVICE];
    if (!service?.image) {
      return null;
    }
    const mounts = (service.volumes ?? [])
      .filter((volume) => typeof volume === 'string' && volume.startsWith('./'))
      .map((volume) => `${appDir}/${volume.slice(2)}`);
    return { image: service.image, mounts };
  } catch (error) {
    logger.warn(`CrowdSec: could not read ${composeFile} for the nginx config test`, {
      error: (error as Error).message,
    });
    return null;
  }
}

const NGINX_CHECK_OK = 'HOMELAB_NGINX_OK';
const NGINX_CHECK_FAIL = 'HOMELAB_NGINX_FAIL';
/** Long enough for init_by_lua to run and nginx to settle; it is killed after. */
const NGINX_CHECK_SECONDS = 6;

/**
 * Does nginx actually come up with the config we just wrote? Answered in a
 * throwaway container from NPM's own image and bind mounts, never against the
 * running NPM (the socket proxy the backend talks to has EXEC off by design,
 * so `docker exec` isn't available — and testing a change by applying it to
 * the live proxy is the outage this whole function exists to avoid).
 *
 * `nginx -t` alone is not enough, and finding that out is the reason this is
 * shaped the way it is: **`-t` never executes `init_by_lua_block`**. Deleting
 * the vendored crowdsec.lua outright and running `-t` reports "test is
 * successful" — and then a real start dies with a Lua traceback. Since the
 * whole enforcement feature hangs off `init_by_lua_block`, a syntax-only check
 * would wave through precisely the failure it is supposed to catch. So the
 * config is tested and then nginx is *started*, and surviving a few seconds is
 * what counts as passing. NPM's nginx.conf already says `daemon off`, so the
 * process stays in the foreground and being killed by the timeout (exit 124)
 * is the success signal.
 *
 * The `npm` user and nginx's temp/cache directories normally come from the
 * image's entrypoint, which `--entrypoint sh` skips; the preamble recreates
 * just enough of them for nginx to read its config, and nothing else.
 *
 * Returns null when nginx is happy, or its own complaint when it isn't. A null
 * return when the *check itself* can't run (no docker, no image) is
 * deliberate: an unavailable check must not become a reason to reject a config
 * that may well be fine.
 */
async function testNpmConfig(appDir: string, composeFile: string): Promise<string | null> {
  const runtime = readNpmComposeRuntime(appDir, composeFile);
  if (!runtime) {
    return null;
  }

  const mounts = runtime.mounts.map((mount) => `-v ${JSON.stringify(mount)}`).join(' ');
  const script = [
    'id -u npm >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin npm',
    'mkdir -p /var/log/nginx /run/nginx /tmp/nginx /var/lib/nginx/cache/public /var/lib/nginx/cache/private /var/cache/nginx/proxy_temp',
    `nginx -t 2>&1 || { echo ${NGINX_CHECK_FAIL}; exit 0; }`,
    `timeout -s QUIT ${NGINX_CHECK_SECONDS} nginx 2>&1`,
    // 124 = still running when the timeout fired, i.e. it started cleanly.
    `[ "$?" = "124" ] || { echo ${NGINX_CHECK_FAIL}; exit 0; }`,
    `echo ${NGINX_CHECK_OK}`,
  ].join('\n');

  // Base64 rather than an inline string: this command is assembled for a host
  // shell, which would happily expand the script's own `$?` before docker ever
  // sees it — and a `$?` that always reads as empty turns the check into one
  // that silently never fails. Encoded, there is nothing left for either shell
  // to interpret.
  const encoded = Buffer.from(script, 'utf8').toString('base64');

  try {
    const output = await run(
      `docker run --rm --entrypoint sh ${mounts} ${runtime.image} -c 'echo ${encoded} | base64 -d | sh'`
    );
    if (output.includes(NGINX_CHECK_OK)) {
      return null;
    }
    return output.includes(NGINX_CHECK_FAIL) ? output.trim() : null;
  } catch (error) {
    // The `docker run` itself failed — not evidence about the config.
    logger.warn('CrowdSec: could not run the nginx config check', { error: (error as Error).message });
    return null;
  }
}

/**
 * Write both managed blocks into NPM's http_top.conf drop-in, verify the
 * result parses, and roll back if it doesn't.
 *
 * Best-effort throughout: NPM's data dir belongs to its (root) container, so
 * if the backend can't write there it logs the manual fallback rather than
 * failing the CrowdSec start.
 */
async function applyNpmHttpTopConfig(enforce: boolean): Promise<void> {
  const npm = resolveComposeFile(NPM_SERVICE);
  if (!npm?.composeFile) {
    logger.info('CrowdSec: Nginx Proxy Manager not installed; skipping its config');
    return;
  }

  const target = path.join(npm.appDir, 'data', 'app', 'nginx', 'custom', 'http_top.conf');

  let existing: string;
  try {
    existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  } catch (error) {
    logger.warn(
      `CrowdSec: cannot read ${target} (${(error as Error).message}). Add the block from ` +
        'apps/nginx-proxy-manager/snippets/cloudflare-real-ip.conf there so bans target real clients.'
    );
    return;
  }

  let next = replaceMarkedBlock(existing, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, buildNpmRealIpBlock());
  next = replaceMarkedBlock(
    next,
    NPM_BOUNCER_MARKER_BEGIN,
    NPM_BOUNCER_MARKER_END,
    enforce ? buildNpmBouncerBlock() : null
  );

  if (next === existing) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next, { mode: 0o644 });
  } catch (error) {
    logger.warn(
      `CrowdSec: could not write ${target} (${(error as Error).message}). Copy ` +
        'apps/nginx-proxy-manager/snippets/cloudflare-real-ip.conf there by hand and restart NPM.'
    );
    return;
  }

  const failure = await testNpmConfig(npm.appDir, npm.composeFile);
  if (failure) {
    // Leaving a config nginx rejects on disk means NPM never comes back from
    // its next restart, and takes every proxied site with it (§99).
    fs.writeFileSync(target, existing, { mode: 0o644 });
    logger.error('CrowdSec: nginx rejected the generated http_top.conf; rolled it back', { error: failure });
    return;
  }

  logger.info(
    `CrowdSec: wrote NPM http_top.conf (real-IP block${enforce ? ' + ban enforcement' : ', enforcement off'}) — restart Nginx Proxy Manager to apply`
  );
}

/**
 * Render the bouncer's config file next to the vendored library. Written
 * whenever enforcement is on and removed when it is off, so the file holding
 * the LAPI key doesn't outlive the feature that uses it.
 *
 * Order matters against applyNpmHttpTopConfig: nginx executes
 * `init_by_lua_block` while parsing, and the bouncer's init treats a missing
 * config file as fatal, so this has to land before the block that loads it.
 */
function applyNpmBouncerConfig(enforce: boolean, apiKey: string | null): void {
  const npm = resolveComposeFile(NPM_SERVICE);
  if (!npm?.appDir) {
    return;
  }

  const target = path.join(npm.appDir, NPM_BOUNCER_DIR, NPM_BOUNCER_CONF_FILE);

  try {
    if (!enforce || !apiKey) {
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
        logger.info('CrowdSec: removed the NPM bouncer config (enforcement off)');
      }
      return;
    }
    if (writeIfChanged(target, buildNpmBouncerConf(apiKey), 0o644)) {
      logger.info('CrowdSec: rendered the NPM bouncer config');
    }
  } catch (error) {
    logger.warn(`CrowdSec: could not write ${target} (${(error as Error).message})`);
  }
}

/**
 * Both NPM-side pieces, in the order they have to happen. Exported so the
 * dashboard toggle applies immediately — a config that nginx would reject is
 * worth finding out about while the operator is still looking at the switch,
 * not at NPM's next restart.
 */
export async function applyNpmCrowdsecConfig(): Promise<void> {
  const crowdsec = resolveComposeFile('crowdsec');
  const { enforceNpm } = await getAlertNotifyConfig();
  const apiKey = crowdsec?.appDir ? readEnvSecret(crowdsec.appDir, NPM_BOUNCER_KEY_ENV) : null;

  if (enforceNpm && !apiKey) {
    logger.warn('CrowdSec: enforcement is on but CROWDSEC_NGINX_BOUNCER_KEY is unset — start CrowdSec once to generate it');
  }

  const enforce = enforceNpm && Boolean(apiKey);
  applyNpmBouncerConfig(enforce, apiKey);
  await applyNpmHttpTopConfig(enforce);
}

/**
 * `profiles.yaml` — the stock upstream default (turns Ip/Range remediation
 * alerts into 4h bans), plus the `http_default` notification wired in when
 * alerting is enabled. We have to own the whole file: CrowdSec has no
 * `profiles.d/`, and this file is also what produces decisions, so a missing
 * or wrong copy would break banning, not just notifications. Mirrors
 * config/profiles.yaml.example.
 */
function buildProfilesYaml(notify: boolean): string {
  const line = notify ? '  - http_default' : '# - http_default';
  return `# Auto-generated by homelab-management on each CrowdSec start (§118.1).
# Do not edit — toggle "CrowdSec alerts" in the dashboard instead.
# Mirrors CrowdSec's upstream default profiles; the only change is the
# http_default notification line, enabled/disabled from the dashboard.
name: default_ip_remediation
filters:
  - Alert.Remediation == true && Alert.GetScope() == "Ip"
decisions:
  - type: ban
    duration: 4h
notifications:
${line}
on_success: break
---
name: default_range_remediation
filters:
  - Alert.Remediation == true && Alert.GetScope() == "Range"
decisions:
  - type: ban
    duration: 4h
notifications:
${line}
on_success: break
`;
}

/**
 * `notifications/http.yaml` for the built-in notification-http plugin. Body is
 * the raw `models.Alert` list as JSON (`{{ .|toJson }}`) — the same shape
 * whether the target is ntfy (now) or an n8n webhook (§118.4), so only the
 * URL ever changes. Batched so a scan burst is one push, not fifty.
 */
function buildHttpNotificationYaml(url: string): string {
  return `# Auto-generated by homelab-management on each CrowdSec start (§118.1).
# Do not edit. Mirrors config/notifications/http.yaml.example.
type: http
name: http_default
log_level: info

# group_wait / timeout are Go durations (unquoted string); group_threshold and
# max_retry are ints — CrowdSec's plugin config rejects a quoted "10" here.
group_wait: 30s
group_threshold: 10
max_retry: 2
timeout: 10s

format: |
  {{ .|toJson }}

url: ${JSON.stringify(url)}
method: POST
headers:
  Content-Type: application/json
`;
}

/** Where CrowdSec POSTs alerts: the n8n relay workflow's webhook. */
function resolveAlertTarget(): string {
  const port = getPublishedUpstreamPort(N8N_SERVICE) ?? N8N_DEFAULT_PORT;
  return `http://host.docker.internal:${port}/webhook/${CROWDSEC_ALERT_WEBHOOK_PATH}`;
}

/**
 * Render profiles.yaml + notifications/http.yaml from the stored alerting
 * setting. Both files are always written (the compose bind mounts must never
 * resolve to an auto-created directory); the enabled flag only controls
 * whether profiles.yaml references the notification.
 */
async function writeCrowdsecAlertConfig(appDir: string): Promise<void> {
  const { crowdsecEnabled } = await getAlertNotifyConfig();
  const target = resolveAlertTarget();

  const profilesChanged = writeIfChanged(
    path.join(appDir, PROFILES_CONFIG_RELATIVE),
    buildProfilesYaml(crowdsecEnabled),
    0o644
  );
  const httpChanged = writeIfChanged(
    path.join(appDir, HTTP_NOTIFY_CONFIG_RELATIVE),
    buildHttpNotificationYaml(target),
    0o644
  );

  if (profilesChanged || httpChanged) {
    logger.info(
      `CrowdSec: rendered alerting config (${crowdsecEnabled ? `enabled → ${target}` : 'disabled'})`
    );
  }
}

/**
 * Render CrowdSec's config files from stored settings. No-op for every other
 * service. Never throws — a failure here must not block the container start.
 */
export async function applyCrowdsecConfigFiles(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== 'crowdsec') {
    return;
  }

  try {
    const lapiKey = readEnvSecret(appDir, BOUNCER_KEY_ENV);
    const exposure = await getExposureConfig();

    if (!lapiKey) {
      logger.warn('CrowdSec: CROWDSEC_BOUNCER_KEY is unset — open the CrowdSec config in the dashboard and Save to generate it');
    }
    if (!exposure) {
      logger.warn('CrowdSec: exposure settings incomplete — the Cloudflare bouncer needs the account/zone/token from Settings → Exposure');
    }

    writeBouncerConfig(appDir, lapiKey, exposure);
    await writeCrowdsecAlertConfig(appDir);
    await applyNpmCrowdsecConfig();
  } catch (error) {
    logger.error('CrowdSec: failed to render config files', { error: (error as Error).message });
  }
}

export const __test = {
  buildBouncerConfig,
  buildNpmRealIpBlock,
  buildNpmBouncerBlock,
  buildNpmBouncerConf,
  buildProfilesYaml,
  buildHttpNotificationYaml,
  replaceMarkedBlock,
  readNpmComposeRuntime,
  NPM_REALIP_MARKER_BEGIN,
  NPM_REALIP_MARKER_END,
  NPM_BOUNCER_MARKER_BEGIN,
  NPM_BOUNCER_MARKER_END,
};
