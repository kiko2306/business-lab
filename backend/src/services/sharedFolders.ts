/**
 * Media apps read their library from a folder inside the shared tree that
 * Samba serves (`apps/nextcloud/data/shared`, §310), so dropping files over
 * SMB is how a library gets filled. Docker would create a missing bind source
 * root-owned 0755, which an SMB client (uid 1000) cannot write to — so each
 * folder is made here, world-writable, before `compose up`. Same reasoning
 * and EPERM tolerance as `ensurePaperlessDropbox`.
 */

import fs from 'fs';
import path from 'path';
import { runCommand } from './backup';

export const SHARED_FOLDERS_BY_APP: Record<string, string[]> = {
  jellyfin: ['media'],
  navidrome: ['music'],
  immich: ['photos'],
  docuseal: ['signed'],
  // Post-consume copies of new documents (paperlessShareCopy.ts).
  paperless: ['paperless-archive'],
  // Watched `compress` pipeline folder + finished folder (stirlingPipelines.ts).
  'stirling-pdf': ['to-stirling-compress', 'from-stirling'],
};

export async function ensureSharedFolders(serviceName: string, appDir: string): Promise<void> {
  for (const name of SHARED_FOLDERS_BY_APP[serviceName] ?? []) {
    const dir = path.join(appDir, '..', 'nextcloud', 'data', 'shared', name);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.chmodSync(dir, 0o777);
    } catch (err) {
      // chmod needs the dir's owner or root; once samba-init's container owns
      // it the backend gets EPERM even though the mode is already fine.
      if ((fs.statSync(dir).mode & 0o007) === 0o007) {
        continue;
      }
      // Closed *and* not ours: a folder Docker made root-owned 0755 as a bind
      // source before this code existed (§870). Throwing here blocked the app's
      // start outright until a Samba restart chowned the tree (§917), so open
      // it as root the way samba-init would — the repo is bind-mounted at its
      // host path, so `dir` is valid for the daemon too.
      try {
        await runCommand('docker', ['run', '--rm', '-v', `${dir}:/d`, 'alpine:latest', 'chmod', '0777', '/d']);
      } catch {
        throw err;
      }
    }
  }
}
