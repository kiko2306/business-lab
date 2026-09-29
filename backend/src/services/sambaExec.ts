/**
 * One-off `smbpasswd -e`/`-d` against Samba's own persisted password
 * database (`/var/lib/samba/private`, bind-mounted so this throwaway
 * container and the long-running one share it), the same shape
 * kimaiDb.ts/itflowDb.ts use for a cold script — the backend reaches Docker
 * through the socket-proxy, which blocks `exec` into the already-running
 * container.
 *
 * `users.conf` (sambaConfig.ts) can create/update an account and set its
 * password on the next start, but it has no way to touch the disabled flag:
 * a revoked account's password otherwise stays valid, and a later re-grant's
 * password change never clears the flag `-d` set — same shape as every other
 * no-SSO app's disable-not-delete/re-enable-on-regrant pair (§493).
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const SAMBA_SERVICE = 'samba';
const SMB_CONF_PATH = '/etc/samba/smb.conf';

// sambaConfig.ts only ever hands this a name it derived itself
// (sambaUsernameFor), but this runs a shell command — refuse anything that
// doesn't match that same safe charset rather than trust the caller.
const SAFE_USERNAME = /^[a-z0-9_-]+$/;

export async function setSambaAccountEnabled(username: string, enabled: boolean): Promise<boolean> {
  if (!SAFE_USERNAME.test(username)) {
    return false;
  }

  const resolved = resolveComposeFile(SAMBA_SERVICE);
  if (!resolved?.composeFile) {
    return false;
  }

  const flag = enabled ? '-e' : '-d';
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `--entrypoint /bin/sh samba -c "smbpasswd ${flag} -c ${SMB_CONF_PATH} ${username}"`;

  return new Promise((resolve) => {
    exec(command, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (error) => {
      resolve(!error);
    });
  });
}
