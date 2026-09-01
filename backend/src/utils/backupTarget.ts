/**
 * Where backups are written: another disk, a NAS, or a network drive.
 *
 * The whole point is that a backup living on the same disk as the data does
 * not survive the failure that matters most. Duplicati ships with
 * `./data/backups` — same filesystem, same host, same disk — which protects
 * against "I deleted a file" and nothing else.
 *
 * The three MOUNTED types are expressed as ONE volume shape, because Docker's
 * local driver takes the same three options for each:
 *
 *   disk  type=none  o=bind                     device=/mnt/backups
 *   nfs   type=nfs   o=addr=10.0.0.5,rw         device=:/volume1/backup
 *   smb   type=cifs  o=username=x,password=y,…  device=//10.0.0.5/backup
 *
 * So the dashboard only has to compute three strings, and the compose file
 * needs a single templated volume rather than a branch per protocol.
 *
 * Google Drive is deliberately NOT in that list: no kernel filesystem exists
 * for it, so it cannot be a mount at all. Duplicati speaks to it directly via
 * a `googledrive://folder?authid=…` target URL. See isMountedKind().
 */

import { query } from './database';

export const BACKUP_TARGET_KEYS = {
  kind: 'backup_target_kind',
  path: 'backup_target_path',
  server: 'backup_target_server',
  share: 'backup_target_share',
  username: 'backup_target_username',
  password: 'backup_target_password',
  options: 'backup_target_options',
  authId: 'backup_target_auth_id',
  folder: 'backup_target_folder',
} as const;

/**
 * Where the user must get a Google Drive AuthID.
 *
 * This is the LEGACY handler, and it is deliberate: it is the service the
 * installed Duplicati actually queries when refreshing a token. Established by
 * testing one AuthID against both services directly —
 *
 *   duplicati-oauth-handler.appspot.com/refresh  -> 404 {"error":"No such key"}
 *   oauth-service.duplicati.com/refresh          -> 200 {"access_token":...}
 *
 * — and then confirming that a token minted by the *newer* service fails at
 * backup time, and that setting the job's `oauth-url` to the newer service
 * does NOT change which one Duplicati consults (the option is stored and
 * ignored by this build's Google Drive backend).
 *
 * So the token has to come from the service Duplicati asks, not the one its
 * own website currently offers. Its error message names this URL — that part
 * of the message is right; the part implying the token is expired is not.
 */
export const DUPLICATI_OAUTH_URL = 'https://duplicati-oauth-handler.appspot.com/?type=googledrive';

/**
 * Destinations come in two families, and the difference is structural:
 *
 *   MOUNTED   disk / smb / nfs — the kernel mounts them, Docker's local driver
 *             does the work, and Duplicati just sees a directory. Testable here
 *             by mounting and writing.
 *   BACKEND   googledrive — no kernel filesystem exists for it. Duplicati
 *             talks to the API itself via a target URL, so there is nothing to
 *             mount and nothing this process can meaningfully write to.
 */
export type BackupTargetKind = 'disk' | 'smb' | 'nfs' | 'googledrive';

/** True when the kind is something the kernel can mount. */
export function isMountedKind(kind: BackupTargetKind): boolean {
  return kind === 'disk' || kind === 'smb' || kind === 'nfs';
}

export interface BackupTarget {
  kind: BackupTargetKind;
  /** Local absolute path — `disk` only. */
  path: string;
  /** Hostname or IP of the NAS — `smb`/`nfs`. */
  server: string;
  /** Share name (smb) or export path (nfs). */
  share: string;
  username: string;
  password: string;
  /** Extra mount options, appended verbatim. Escape hatch for odd NAS setups. */
  options: string;
  /**
   * Google Drive AuthID, obtained from Duplicati's OAuth service. It is a
   * long-lived refresh token, so it is stored and masked like a password.
   */
  authId: string;
  /** Folder within the destination — Google Drive only. */
  folder: string;
}

/** What the compose file consumes: exactly the three local-driver options. */
export interface BackupMountSpec {
  type: string;
  o: string;
  device: string;
}

export async function getBackupTarget(): Promise<BackupTarget | null> {
  const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
    Object.values(BACKUP_TARGET_KEYS),
  ]);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const kind = values[BACKUP_TARGET_KEYS.kind];
  if (kind !== 'disk' && kind !== 'smb' && kind !== 'nfs' && kind !== 'googledrive') {
    return null;
  }

  return {
    kind,
    path: values[BACKUP_TARGET_KEYS.path] ?? '',
    server: values[BACKUP_TARGET_KEYS.server] ?? '',
    share: values[BACKUP_TARGET_KEYS.share] ?? '',
    username: values[BACKUP_TARGET_KEYS.username] ?? '',
    password: values[BACKUP_TARGET_KEYS.password] ?? '',
    options: values[BACKUP_TARGET_KEYS.options] ?? '',
    authId: values[BACKUP_TARGET_KEYS.authId] ?? '',
    folder: values[BACKUP_TARGET_KEYS.folder] ?? '',
  };
}

/**
 * The Duplicati target URL for a backend-family destination.
 *
 * Returns null for mounted kinds — those are a plain directory to Duplicati,
 * so the "destination" is just the path the volume is mounted at.
 */
export function toDuplicatiUrl(target: BackupTarget): string | null {
  if (target.kind !== 'googledrive') return null;
  const folder = target.folder.trim().replace(/^\/+|\/+$/g, '') || 'homelab-backups';

  // The AuthID is inserted RAW, not percent-encoded.
  //
  // Duplicati AuthIDs contain a colon, and encodeURIComponent turns it into
  // %3A — Duplicati then looks up a key that does not exist and fails with
  // "Failed to authorize using the OAuth service: No such key" and a 404.
  // That error names the OAuth service, so it reads like an expired or
  // wrong-service token and sends you off to regenerate a perfectly good one.
  //
  // A colon is legal in a query-string value; the characters that genuinely
  // would break this URL are rejected at save time instead (validateTarget).
  return `googledrive://${encodeURI(folder)}?authid=${target.authId}`;
}

/**
 * Translate a target into the three Docker local-driver options.
 *
 * Mount options are joined with commas, so a value containing one would be
 * read as a separate option — a password with a comma in it would silently
 * mangle the mount rather than fail. Rejected up front instead.
 */
export function toMountSpec(target: BackupTarget): BackupMountSpec {
  if (!isMountedKind(target.kind)) {
    // Callers must branch on the family. Returning a plausible-looking spec
    // for Google Drive would produce a volume that fails at backup time.
    throw new Error(`${target.kind} is not a mounted destination`);
  }
  const extra = target.options.trim();

  if (target.kind === 'disk') {
    // Bind mounts take no credentials and no options worth templating.
    return { type: 'none', o: 'bind', device: target.path };
  }

  if (target.kind === 'nfs') {
    const parts = [`addr=${target.server}`, 'rw'];
    if (extra) parts.push(extra);
    // A leading colon is what the local driver expects for an NFS export.
    const share = target.share.startsWith(':') ? target.share : `:${target.share}`;
    return { type: 'nfs', o: parts.join(','), device: share };
  }

  const parts: string[] = [];
  if (target.username) parts.push(`username=${target.username}`);
  if (target.password) parts.push(`password=${target.password}`);
  // Default to SMB3: SMB1 is disabled by default on every current NAS and OS,
  // and omitting a version makes the kernel negotiate down and often fail with
  // a bare "permission denied" that looks like wrong credentials.
  if (!/vers=/.test(extra)) parts.push('vers=3.0');
  // Files land owned by the Duplicati container's user, or it cannot write.
  if (!/uid=/.test(extra)) parts.push('uid=1000', 'gid=1000');
  if (extra) parts.push(extra);

  const share = target.share.replace(/^\/+/, '');
  return { type: 'cifs', o: parts.join(','), device: `//${target.server}/${share}` };
}

/** Human-readable validation. Returns null when the target is usable. */
export function validateTarget(target: BackupTarget): string | null {
  const commaFields: [string, string][] = [
    ['username', target.username],
    ['password', target.password],
  ];
  for (const [name, value] of commaFields) {
    if (value.includes(',')) {
      return `The ${name} cannot contain a comma — mount options are comma-separated, so it would corrupt the mount.`;
    }
  }

  if (target.kind === 'googledrive') {
    if (!target.authId) {
      return 'Paste the AuthID from Duplicati\'s Google authorisation page.';
    }
    // The AuthID goes into the target URL unencoded (see toDuplicatiUrl), so
    // anything that would terminate or split the query string is refused here
    // rather than silently corrupting the URL. A colon is fine and common.
    if (/[&#?\s]/.test(target.authId)) {
      return 'That AuthID contains a character that cannot appear in the destination URL — re-copy it from the authorisation page.';
    }
    return null;
  }

  if (target.kind === 'disk') {
    if (!target.path.startsWith('/')) return 'Enter an absolute path, e.g. /mnt/backups.';
    // The whole point is surviving the loss of this disk.
    if (/^\/(home|root|var\/lib\/docker)(\/|$)/.test(target.path)) {
      return 'That path is on the system disk. Choose a separate disk or a network share, or the backup dies with the machine.';
    }
    return null;
  }

  if (!target.server) return 'Enter the NAS hostname or IP address.';
  if (!target.share) return target.kind === 'nfs' ? 'Enter the NFS export path, e.g. /volume1/backup.' : 'Enter the share name.';
  if (target.kind === 'smb' && !target.username) return 'Enter the username for the share.';
  return null;
}
