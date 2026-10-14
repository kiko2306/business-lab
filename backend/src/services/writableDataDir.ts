/**
 * Make an app's bind-mounted data dir writable by every uid before
 * `compose up`, for the apps whose own uid writes straight into a dir the
 * backend created. The backend's root lands on the host as 100:101, so a dir
 * it made (a fresh clone, a restore) is `0775` 100:101 and the app's own uid
 * can read but not create files there.
 *
 * - Twenty (uid 1000) `mkdir`s per-workspace storage in `data/storage`; the
 *   first signup failed with EACCES (§371).
 * - Mealie (uid 911) keeps `mealie.db` in `data/` itself and SQLite must create
 *   `mealie.db-journal` beside it, so every write failed with "attempt to write
 *   a readonly database" — sign-ins and recipe imports for weeks (§937).
 *
 * `chmod 0777` sidesteps the ownership question the same way
 * `ensurePaperlessDropbox` and `samba-init` do: whichever container uid gets
 * there first can write.
 */

import fs from 'fs';
import path from 'path';

const WRITABLE_DATA_DIRS: Record<string, string> = {
  twenty: 'data/storage',
  mealie: 'data',
};

export function ensureWritableDataDir(serviceName: string, appDir: string): void {
  const rel = WRITABLE_DATA_DIRS[serviceName];
  if (!rel) return;
  const dir = path.join(appDir, rel);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o777);
  } catch (err) {
    // chmod only succeeds as the dir's owner or root. Once the app's own uid
    // owns it, the backend container is neither and chmod throws EPERM even
    // though the mode is already fine. Re-raise only if it genuinely is not
    // writable-by-all.
    if ((fs.statSync(dir).mode & 0o007) !== 0o007) {
      throw err;
    }
  }
}
