/**
 * Ensure the one-way drop box `apps/paperless/compose.yaml` bind-mounts into
 * `consume/` exists before `compose up` (§219, §220) — a subfolder of the
 * shared tree File Browser and Samba already share, not the whole tree:
 * Paperless's consumer watches whatever lands here, OCRs/tags it and deletes
 * the original, so "move a file into `to-paperless/`" is the deliberate way
 * to file something, not "everything shared is visible to Paperless."
 *
 * `apps/*, /data/` is gitignored, so a fresh clone has nothing here yet.
 * Docker would auto-create the bind source as an empty root-owned directory
 * on first `up`, which Paperless (running as uid 1000) could read but not
 * write to — it needs to delete the original after consuming it. `chmod
 * 0777` sidesteps the ownership question the same way `filebrowser-init`'s
 * `chmod -R o+rwX /srv` does for Nextcloud's External Storage mount (§220):
 * whichever app's container uid gets there first, it can write.
 */

import fs from 'fs';
import path from 'path';

export function ensurePaperlessDropbox(appDir: string): void {
  const dir = path.join(appDir, '..', 'file-browser', 'data', 'files', 'to-paperless');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.chmodSync(dir, 0o777);
  } catch (err) {
    // chmod succeeds only as the dir's owner (or root). Once the dir already
    // exists owned by another uid — e.g. file-browser's container created it —
    // the backend container is neither, and chmod throws EPERM even when the
    // mode is already 0777. That is harmless: this call only ever wanted the
    // dir world-writable so whichever app's uid gets there first can write and
    // delete. Re-raise only if it is genuinely not writable-by-all.
    if ((fs.statSync(dir).mode & 0o007) !== 0o007) {
      throw err;
    }
  }
}
