/**
 * Grant a dashboard user their own login on the Samba share, matching their
 * own password rather than the single shared legacy account (§480-style
 * fan-out) — the pattern this file follows is the same as
 * jellyfinUserProvisioning.ts, but Samba has no HTTP API to call: dockur/samba
 * only creates/updates accounts from `users.conf` at container start
 * (sambaConfig.ts's `regenerateSambaFiles`), so "provision" here means
 * rewriting that file with this user's real password and every other
 * granted user's line left untouched (`*`), then recreating the container so
 * it takes effect immediately instead of waiting for the next unrelated
 * restart.
 *
 * Every granted user shares the legacy account's UID/GID and the one shared
 * folder — this grants a login, not a private folder (see sambaConfig.ts's
 * module doc comment).
 *
 * `disableSambaUser` (§493's disable-not-delete shape): `users.conf` has no
 * way to flip an existing account's disabled flag, so revoke and re-grant
 * both go through sambaExec.ts's throwaway-container `smbpasswd -d`/`-e`
 * against the same persisted passdb the running container reads — a plain
 * password change through `users.conf` alone would leave a revoked account
 * disabled forever, and a revoked one's old password would otherwise stay
 * valid after the file drops its line.
 */

import logger from '../utils/logger';
import { query } from '../utils/database';
import { resolveComposeFile } from '../config/services';
import { restartService } from './executor';
import { SAMBA_SERVICE, regenerateSambaFiles, sambaUsernameFor } from './sambaConfig';
import { setSambaAccountEnabled } from './sambaExec';

export interface SambaUserInput {
  email: string;
  password: string;
}

async function findDashboardUser(email: string): Promise<{ id: number; username: string } | null> {
  const result = await query<{ id: number; username: string }>('SELECT id, username FROM users WHERE email = $1', [
    email,
  ]);
  return result.rows[0] ?? null;
}

export type ProvisionSambaUserResult = 'updated' | 'failed' | 'not-installed' | 'not-found';

export async function provisionSambaUser(input: SambaUserInput): Promise<ProvisionSambaUserResult> {
  const resolved = resolveComposeFile(SAMBA_SERVICE);
  if (!resolved?.composeFile) {
    logger.warn('Samba user provisioning skipped: Samba is not installed');
    return 'not-installed';
  }

  const user = await findDashboardUser(input.email);
  if (!user) {
    logger.warn(`Samba user provisioning skipped: no dashboard account for ${input.email}`);
    return 'not-found';
  }

  const usernames = await regenerateSambaFiles(resolved.appDir, { userId: user.id, password: input.password });
  const sambaUsername = usernames.get(user.id);
  if (!sambaUsername) {
    logger.error(`Samba user provisioning failed for ${input.email}: not in the granted list`);
    return 'failed';
  }

  await restartService(SAMBA_SERVICE, null);
  // A re-grant after a prior revoke should work again — the password change
  // above never clears the disabled flag `disableSambaUser`'s `-d` set.
  await setSambaAccountEnabled(sambaUsername, true);

  logger.info(`Synced the Samba account for ${input.email} (${sambaUsername})`);
  return 'updated';
}

export type DisableSambaUserResult = 'disabled' | 'not-found' | 'failed' | 'not-installed';

export async function disableSambaUser(email: string): Promise<DisableSambaUserResult> {
  const resolved = resolveComposeFile(SAMBA_SERVICE);
  if (!resolved?.composeFile) {
    return 'not-installed';
  }

  const user = await findDashboardUser(email);
  if (!user) {
    logger.warn(`No dashboard account found for ${email} to disable in Samba`);
    return 'not-found';
  }

  const sambaUsername = sambaUsernameFor(user.username);
  const ok = await setSambaAccountEnabled(sambaUsername, false);
  if (!ok) {
    logger.error(`Failed to disable the Samba account for ${email}`);
    return 'failed';
  }

  logger.info(`Disabled the Samba account for ${email} (${sambaUsername})`);
  return 'disabled';
}
