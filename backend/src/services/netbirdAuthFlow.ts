/**
 * Keeps NetBird's native-client login on the OIDC **device-code** flow by
 * removing PKCEAuthorizationFlow from apps/netbird-vpn/data/management.json
 * (plan.md §413).
 *
 * NetBird's client tries PKCE first on every platform except headless
 * Linux/FreeBSD, and only falls back to the device-code flow if fetching the
 * PKCE config from management fails. PKCE there means RFC 8252 loopback: the
 * app listens on 127.0.0.1:53000 and the browser is redirected back to it.
 * Nothing listens on a phone, so on Android/iOS the browser lands on
 * http://localhost:53000 and shows "connection refused" after a successful
 * Authelia login. Same story on Windows, where 53000 sits in the
 * Hyper-V/WSL excluded port range and the client silently picks a different
 * port that Authelia has not registered as a redirect_uri.
 *
 * Removing the flow is the only server-side lever: management serves one
 * config to every client, and the client picks PKCE whenever it can get it.
 * The cost is one extra step on desktop (confirm a code) — the device flow
 * works on every platform, needs no loopback listener and no per-port
 * redirect_uri registration.
 *
 * Lives here rather than in start.sh (which generates management.json in the
 * first place) because the dashboard's Update page deploys a new checkout
 * without running start.sh, and management.json is never regenerated once it
 * exists — it holds the store encryption key.
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { getAppsDir } from '../config/services';

const SERVICE = 'netbird-vpn';
const PKCE_KEY = 'PKCEAuthorizationFlow';

export function managementJsonPath(): string {
  return path.join(getAppsDir(), 'netbird-vpn', 'data', 'management.json');
}

/**
 * Returns the rewritten JSON text, or null if nothing needed changing —
 * the caller only logs (and management only needs restarting) on a real
 * change, same read-compare-then-write reasoning as start.sh's Signal.URI
 * patch. Pure, so the decision is unit-testable without a filesystem.
 */
export function stripPkceFlow(configText: string): string | null {
  const config = JSON.parse(configText) as Record<string, unknown>;
  if (!(PKCE_KEY in config)) return null;
  delete config[PKCE_KEY];
  return `${JSON.stringify(config, null, 2)}\n`;
}

export async function ensureNetbirdDeviceCodeFlow(serviceName: string): Promise<void> {
  if (serviceName !== SERVICE) return;

  const file = managementJsonPath();
  try {
    const next = stripPkceFlow(await fs.readFile(file, 'utf8'));
    if (!next) return;
    // Overwrites in place, keeping the existing inode and its 600 mode —
    // the file is bind-mounted read-only into netbird-management, which
    // reads it only at startup, and this runs before `compose up`.
    await fs.writeFile(file, next);
    logger.info(
      'NetBird: removed PKCEAuthorizationFlow from management.json — native clients now use the device-code flow, which works on mobile (§413)'
    );
  } catch (error) {
    // Absent on a deployment that has never started NetBird, and malformed
    // only if someone hand-edited it. Either way this must not block a start:
    // the app comes up with whatever config is already there.
    logger.warn('NetBird: could not update management.json for the device-code flow', {
      file,
      error: (error as Error).message,
    });
  }
}
