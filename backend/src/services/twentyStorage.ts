/**
 * Ensure `apps/twenty/data/storage` exists and is writable before `compose up`
 * (§371). Twenty's server + worker run as uid 1000 (`node`) and write per-
 * workspace application data into it (`.local-storage/<workspace-id>/`); the
 * very first thing a workspace signup does is `mkdir` there. `apps/*, /data/`
 * is gitignored, so on a fresh clone — or a deploy that didn't run
 * `start.sh`'s permissions pass — Docker auto-creates the bind source as an
 * empty **root-owned** directory and the signup fails with `EACCES`.
 *
 * `chmod 0777` sidesteps the ownership question the same way
 * `ensurePaperlessDropbox` and `samba-init` do: whichever container uid gets
 * there first can write.
 */

import fs from 'fs';
import path from 'path';

export function ensureTwentyStorage(appDir: string): void {
  const dir = path.join(appDir, 'data', 'storage');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o777);
  } catch (err) {
    // chmod only succeeds as the dir's owner or root. Once Twenty's own uid
    // owns it (after a first successful start), the backend container is
    // neither and chmod throws EPERM even though the mode is already fine.
    // Harmless — re-raise only if it genuinely is not writable-by-all.
    if ((fs.statSync(dir).mode & 0o007) !== 0o007) {
      throw err;
    }
  }
}
