/**
 * Shared machinery for writing a marker-fenced block into one of Nginx Proxy
 * Manager's custom-config drop-ins and proving nginx actually starts with it,
 * before it ever reaches the live proxy. Extracted out of crowdsecConfig.ts
 * (§119, §124.5), which built this for http_top.conf's real-IP/bouncer
 * blocks — npmSecurityHeaders.ts (§402, HSTS in server_proxy.conf) is the
 * second caller, and this file exists so both share one config-test-and-
 * rollback path rather than drifting apart.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import logger from '../utils/logger';

export const NPM_SERVICE = 'nginx-proxy-manager';

export function run(command: string): Promise<string> {
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One canonical form for a config file edited by marker-fenced blocks: no
 * leading blank lines, exactly one blank line between blocks, exactly one
 * trailing newline — so re-rendering an unchanged block never "changes" the
 * file and costs a phantom rewrite + config test.
 */
export function normaliseConf(text: string): string {
  const body = text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');
  return body ? `${body}\n` : '';
}

/**
 * Insert, replace or (with `block: null`) remove one marker-fenced block in a
 * config file, leaving everything around it — including other blocks, and
 * anything an operator added by hand — in place.
 */
export function replaceMarkedBlock(existing: string, begin: string, end: string, block: string | null): string {
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
 * NPM's compose file, as the source of the image and bind mounts a config
 * test has to reproduce. Reading them rather than hardcoding means the test
 * keeps matching the real container when a mount is added to that file.
 */
export function readNpmComposeRuntime(appDir: string, composeFile: string): { image: string; mounts: string[] } | null {
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
    logger.warn(`NPM config: could not read ${composeFile} for the nginx config test`, {
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
 * `nginx -t` alone is not enough: it never executes `init_by_lua_block`, so a
 * config that is syntactically fine but dies on boot (the reason CrowdSec's
 * bouncer block needed this in the first place) would sail through a
 * syntax-only check. So the config is tested and then nginx is *started*,
 * and surviving a few seconds is what counts as passing. NPM's nginx.conf
 * already says `daemon off`, so the process stays in the foreground and
 * being killed by the timeout (exit 124) is the success signal.
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
export async function testNpmConfig(appDir: string, composeFile: string): Promise<string | null> {
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
    logger.warn('NPM config: could not run the nginx config check', { error: (error as Error).message });
    return null;
  }
}

/**
 * Write one marker-fenced block into an NPM custom-config file, verify the
 * result parses and actually boots, and roll back if it doesn't.
 *
 * Best-effort: NPM's data dir belongs to its (root) container, so if the
 * backend can't read/write there it logs and returns rather than failing the
 * caller's own start.
 */
export async function applyNpmMarkedBlock(opts: {
  logPrefix: string;
  npmAppDir: string;
  npmComposeFile: string;
  target: string;
  begin: string;
  end: string;
  block: string | null;
  manualFallbackHint: string;
}): Promise<void> {
  let existing: string;
  try {
    existing = fs.existsSync(opts.target) ? fs.readFileSync(opts.target, 'utf8') : '';
  } catch (error) {
    logger.warn(`${opts.logPrefix}: cannot read ${opts.target} (${(error as Error).message}). ${opts.manualFallbackHint}`);
    return;
  }

  const next = replaceMarkedBlock(existing, opts.begin, opts.end, opts.block);
  if (next === existing) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(opts.target), { recursive: true });
    fs.writeFileSync(opts.target, next, { mode: 0o644 });
  } catch (error) {
    logger.warn(`${opts.logPrefix}: could not write ${opts.target} (${(error as Error).message}). ${opts.manualFallbackHint}`);
    return;
  }

  const failure = await testNpmConfig(opts.npmAppDir, opts.npmComposeFile);
  if (failure) {
    // Leaving a config nginx rejects on disk means NPM never comes back from
    // its next restart, and takes every proxied site with it (§99).
    fs.writeFileSync(opts.target, existing, { mode: 0o644 });
    logger.error(`${opts.logPrefix}: nginx rejected the generated ${path.basename(opts.target)}; rolled it back`, {
      error: failure,
    });
    return;
  }

  logger.info(`${opts.logPrefix}: wrote ${path.basename(opts.target)} — restart Nginx Proxy Manager to apply`);
}
