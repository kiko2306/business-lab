/**
 * HSTS for every proxied host (§402 — one of Nextcloud's own admin-panel
 * warnings, "Cabeçalhos HTTP: Strict-Transport-Security não está definido").
 *
 * Can't be fixed inside Nextcloud, or any other app: TLS terminates at
 * Cloudflare's edge, and every hop after that — the tunnel, NPM, the app
 * itself — only ever sees plain HTTP. An app's own HSTS logic (Nextcloud's
 * `.htaccess` included) keys off the request scheme it sees, which is always
 * `http`, so it can never fire here regardless of `OVERWRITEPROTOCOL=https`.
 * NPM is the only hop that can plausibly add it, and since every request
 * that reaches NPM in this architecture arrived via Cloudflare's HTTPS-only
 * edge, the header can be added unconditionally rather than keyed off a
 * forwarded-proto header.
 *
 * Written into `server_proxy.conf`, not `http_top.conf` (used by CrowdSec):
 * that file is included inside every generated per-host proxy server block,
 * so it sits at the same scope as the Authelia/gRPC `advanced_config`
 * location overrides (npmClient.ts) instead of above them — an `add_header`
 * declared at http{} scope is silently dropped for any location that
 * declares its own `add_header` (nginx's documented inheritance rule), which
 * would have quietly skipped HSTS on exactly the hosts guarded by those
 * overrides.
 *
 * Reuses the marker-replace + nginx-boot-test + rollback machinery
 * npmConfigWriter.ts pulled out of crowdsecConfig.ts, rather than a second
 * copy of it.
 */

import path from 'path';
import { resolveComposeFile } from '../config/services';
import { NPM_SERVICE, applyNpmMarkedBlock } from './npmConfigWriter';

const HSTS_MARKER_BEGIN = '# >>> homelab-management: hsts >>>';
const HSTS_MARKER_END = '# <<< homelab-management: hsts <<<';

// 15552000s = 180 days, the minimum Nextcloud's own check accepts and a
// common baseline (browser preload lists want 1 year, but this is enough to
// clear the warning without committing every proxied host to a year-long
// HTTPS-only lock-in before HTTPS-only is fully proven out here).
const HSTS_MAX_AGE_SECONDS = 15552000;

function buildHstsBlock(): string {
  return [
    HSTS_MARKER_BEGIN,
    '# Every request that reaches NPM in this deployment arrived through',
    "# Cloudflare's HTTPS-only edge (TLS terminates there; the tunnel, NPM and",
    '# the app all only ever see plain HTTP after that) — so the header is',
    '# unconditional here, not keyed off a forwarded-proto check.',
    `add_header Strict-Transport-Security "max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains" always;`,
    HSTS_MARKER_END,
    '',
  ].join('\n');
}

/**
 * Write the HSTS block into NPM's server_proxy.conf drop-in. Runs on NPM's
 * own start, before its `compose up` — so unlike CrowdSec's http_top.conf
 * writes (triggered by *CrowdSec's* start, applying only on NPM's next
 * restart) this takes effect the moment NPM itself comes up. No-op for every
 * other service.
 */
export async function applyNpmSecurityHeaders(serviceName: string): Promise<void> {
  if (serviceName !== NPM_SERVICE) {
    return;
  }

  const npm = resolveComposeFile(NPM_SERVICE);
  if (!npm?.composeFile) {
    return;
  }

  await applyNpmMarkedBlock({
    logPrefix: 'HSTS',
    npmAppDir: npm.appDir,
    npmComposeFile: npm.composeFile,
    target: path.join(npm.appDir, 'data', 'app', 'nginx', 'custom', 'server_proxy.conf'),
    begin: HSTS_MARKER_BEGIN,
    end: HSTS_MARKER_END,
    block: buildHstsBlock(),
    manualFallbackHint:
      'Add `add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;` to ' +
      'data/app/nginx/custom/server_proxy.conf by hand and restart NPM.',
  });
}

export const __test = { buildHstsBlock, HSTS_MARKER_BEGIN, HSTS_MARKER_END };
