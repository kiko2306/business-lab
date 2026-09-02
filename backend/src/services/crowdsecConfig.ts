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
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../utils/logger';
import { getExposureConfig } from '../utils/exposureSettings';
import { resolveComposeFile } from '../config/services';
import { parseEnvFile } from '../utils/envFile';

const NPM_SERVICE = 'nginx-proxy-manager';
const BOUNCER_CONFIG_RELATIVE = path.join('config', 'cloudflare-worker-bouncer.yaml');
const BOUNCER_KEY_ENV = 'CROWDSEC_BOUNCER_KEY';

const NPM_REALIP_MARKER_BEGIN = '# >>> homelab-management: crowdsec real-ip >>>';
const NPM_REALIP_MARKER_END = '# <<< homelab-management: crowdsec real-ip <<<';

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

function readBouncerKey(appDir: string): string | null {
  const envPath = path.join(appDir, '.env');
  if (!fs.existsSync(envPath)) {
    return null;
  }
  const value = parseEnvFile(envPath)[BOUNCER_KEY_ENV]?.trim();
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
 * Add the Cloudflare real-IP block to NPM's http_top.conf drop-in and reload
 * nginx. Best-effort: NPM's data dir is written by its (root) container, so if
 * the backend can't create the file it logs the manual fallback instead of
 * failing the CrowdSec start.
 */
async function applyNpmRealIpConfig(): Promise<void> {
  const npm = resolveComposeFile(NPM_SERVICE);
  if (!npm?.composeFile) {
    logger.info('CrowdSec: Nginx Proxy Manager not installed; skipping real-IP config');
    return;
  }

  const target = path.join(npm.appDir, 'data', 'app', 'nginx', 'custom', 'http_top.conf');
  const block = buildNpmRealIpBlock();

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

  const next = existing.includes(NPM_REALIP_MARKER_BEGIN)
    ? existing.replace(
        new RegExp(`${escapeRegExp(NPM_REALIP_MARKER_BEGIN)}[\\s\\S]*?${escapeRegExp(NPM_REALIP_MARKER_END)}\\n?`),
        block
      )
    : existing
      ? `${existing.replace(/\n*$/, '')}\n\n${block}`
      : block;

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

  logger.info('CrowdSec: wrote Cloudflare real-IP block to NPM http_top.conf');
  try {
    const container = (
      await run(`docker ps --filter "label=com.docker.compose.project=${NPM_SERVICE}" --format "{{.Names}}"`)
    )
      .trim()
      .split('\n')[0];
    if (container) {
      await run(`docker exec ${container} nginx -s reload`);
      logger.info('CrowdSec: reloaded Nginx Proxy Manager for the real-IP config');
    }
  } catch (error) {
    logger.warn(`CrowdSec: nginx reload failed (${(error as Error).message}); restart NPM to apply the real-IP config`);
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
    const lapiKey = readBouncerKey(appDir);
    const exposure = await getExposureConfig();

    if (!lapiKey) {
      logger.warn('CrowdSec: CROWDSEC_BOUNCER_KEY is unset — open the CrowdSec config in the dashboard and Save to generate it');
    }
    if (!exposure) {
      logger.warn('CrowdSec: exposure settings incomplete — the Cloudflare bouncer needs the account/zone/token from Settings → Exposure');
    }

    writeBouncerConfig(appDir, lapiKey, exposure);
    await applyNpmRealIpConfig();
  } catch (error) {
    logger.error('CrowdSec: failed to render config files', { error: (error as Error).message });
  }
}

export const __test = { buildBouncerConfig, buildNpmRealIpBlock, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END };
