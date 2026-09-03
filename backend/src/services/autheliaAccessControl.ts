/**
 * Generates Authelia's `access_control` block in
 * `apps/authelia/config/configuration.yml` from the live set of exposed +
 * Authelia-protected apps (plan.md §151 slice 2d).
 *
 * Model: `default_policy: deny`, plus one `one_factor` rule per gated app that
 * admits `group:admins` (every webmaster) or `group:app-<name>` (a user the
 * dashboard granted that app — see autheliaSync.ts). An app with no rule is
 * unreachable. Authelia's own portal is `bypass` so `deny` can't lock the
 * login page itself out.
 *
 * Unlike the users file (§157, hot-reloaded via `watch: true`), a
 * `configuration.yml` change needs an Authelia restart — which 502s every
 * gated app for a few seconds — so this only restarts when the block actually
 * changed, and only fires on an exposure change, never on a user change.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getExposureConfig } from '../utils/exposureSettings';
import { getAppAccessOptions } from './userAppAccess';
import { appGroupName } from './autheliaSync';
import { getUsersDatabasePath } from './autheliaUsers';
import path from 'path';

const execFileAsync = promisify(execFile);

const MARK_BEGIN =
  '# >>> managed by the dashboard — plan.md §151; regenerated on every exposure change, manual edits are lost';
const MARK_END = '# <<< managed by the dashboard';

/** `configuration.yml` sits next to `users_database.yml` in the authelia app. */
function getConfigPath(): string | null {
  const usersPath = getUsersDatabasePath();
  return usersPath ? path.join(path.dirname(usersPath), 'configuration.yml') : null;
}

interface GatedApp {
  hostname: string;
  group: string;
}

/** Render the full `access_control:` block (marker comments included). */
export function renderAccessControl(portalDomain: string | null, gated: GatedApp[]): string {
  const lines: string[] = [MARK_BEGIN, 'access_control:', '  default_policy: deny', '  rules:'];

  if (portalDomain) {
    lines.push(`    - domain: '${portalDomain}'`, `      policy: bypass`);
  }
  for (const app of gated) {
    lines.push(
      `    - domain: '${app.hostname}'`,
      `      policy: one_factor`,
      `      subject:`,
      `        - 'group:admins'`,
      `        - 'group:${app.group}'`
    );
  }
  lines.push(MARK_END, '');
  return lines.join('\n');
}

/** The gated apps, as `{ hostname, group }`, from the live exposure rows. */
async function getGatedApps(): Promise<GatedApp[]> {
  const options = await getAppAccessOptions();
  return options
    .filter((o) => o.hostname)
    .map((o) => ({ hostname: o.hostname as string, group: appGroupName(o.serviceName) }));
}

async function getPortalDomain(): Promise<string | null> {
  const row = await query<{ hostname: string | null }>(
    "SELECT hostname FROM service_exposure WHERE service_name = 'authelia'"
  );
  if (row.rows[0]?.hostname) {
    return row.rows[0].hostname;
  }
  const config = await getExposureConfig();
  return config?.baseDomain ? `authelia.${config.baseDomain}` : null;
}

/**
 * Replace the `access_control:` block in-place. Anchors on the managed marker
 * pair if present, else on the structural span (`access_control:` and the
 * indented/comment/blank lines under it, up to the next top-level key).
 */
export function spliceAccessControl(configText: string, block: string): string {
  const marked = new RegExp(
    `${MARK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARK_END.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )}\\n?`
  );
  if (marked.test(configText)) {
    return configText.replace(marked, block);
  }
  const structural = /^access_control:\n(?:[ \t].*\n|#.*\n|\n)*/m;
  if (structural.test(configText)) {
    return configText.replace(structural, block);
  }
  // No access_control at all — prepend it after the first line.
  return `${block}\n${configText}`;
}

async function restartAuthelia(): Promise<void> {
  const resolved = resolveComposeFile('authelia');
  if (!resolved?.composeFile) {
    throw new Error('Cannot restart Authelia: its compose file was not found.');
  }
  // `restart` (not `up -d`) is enough — configuration.yml is a bind mount, so
  // the new content is already in place; Authelia just has to re-read it.
  await execFileAsync(
    'docker',
    ['compose', '-p', resolved.projectName, '-f', resolved.composeFile, 'restart', 'authelia'],
    { timeout: 90_000 }
  );
}

export interface AccessControlSyncResult {
  changed: boolean;
  restarted: boolean;
  ruleCount: number;
  reason?: 'authelia-not-installed';
}

/**
 * Regenerate the `access_control` block and, if it changed, restart Authelia.
 */
export async function syncAutheliaAccessControl(trigger: string): Promise<AccessControlSyncResult> {
  const configPath = getConfigPath();
  if (!configPath || !fs.existsSync(configPath)) {
    return { changed: false, restarted: false, ruleCount: 0, reason: 'authelia-not-installed' };
  }

  const [portalDomain, gated] = await Promise.all([getPortalDomain(), getGatedApps()]);
  const block = renderAccessControl(portalDomain, gated);

  const current = fs.readFileSync(configPath, 'utf8');
  const next = spliceAccessControl(current, block);
  if (next === current) {
    return { changed: false, restarted: false, ruleCount: gated.length };
  }

  fs.writeFileSync(configPath, next, { mode: 0o640 });
  logger.info(
    `Authelia access_control (${trigger}): wrote ${gated.length} rule(s); restarting Authelia to apply`
  );
  await restartAuthelia();
  return { changed: true, restarted: true, ruleCount: gated.length };
}

/** Never-throws wrapper for the exposure routes: audits a failure, returns a warning string. */
export async function syncAutheliaAccessControlSafe(
  trigger: string,
  userId: number | null
): Promise<string | null> {
  try {
    const result = await syncAutheliaAccessControl(trigger);
    return result.changed && !result.restarted
      ? 'Authelia rules were written but the restart did not confirm — check the service.'
      : null;
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Authelia access_control (${trigger}) failed: ${message}`);
    await writeAuditLog({
      userId,
      action: 'authelia_access_control_sync',
      resource: trigger,
      result: 'failure',
      metadata: { error: message },
    }).catch(() => {});
    return 'The exposure change was saved, but updating Authelia access rules failed — check the server logs.';
  }
}
