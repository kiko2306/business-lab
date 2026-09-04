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
 * Duplicati's OAuth handler has TWO endpoints, and they are not interchangeable.
 * Conflating them cost a working backup: appending `/refresh` to the login URL
 * produced `.../?type=googledrive/refresh`, whose path is `/` and whose query is
 * `type=googledrive/refresh`. That address answers **405 Method Not Allowed**,
 * so every token refresh during a backup failed — surfacing as 403s and
 * `TimeoutException` inside `GetFolderIdAsync`, which look like a credential or
 * network fault and are neither. Hence two separate constants and no string
 * surgery joining them.
 *
 * Both point at the LEGACY appspot handler deliberately: it is the service this
 * Duplicati build actually consults. Established by testing one AuthID against
 * both services directly —
 *
 *   duplicati-oauth-handler.appspot.com/refresh  -> 200 {"access_token":...}
 *   oauth-service.duplicati.com/refresh          -> 200, but a token minted
 *                                                   there fails at backup time
 *
 * So the AuthID has to come from the service Duplicati asks, not the one its
 * website currently offers.
 */

/** User-facing: the page where a Google AuthID is obtained. Not for refreshes. */
export const DUPLICATI_OAUTH_LOGIN_URL = 'https://duplicati-oauth-handler.appspot.com/?type=googledrive';

/** Duplicati-facing: the job's `oauth-url`, POSTed to when refreshing a token. */
export const DUPLICATI_OAUTH_REFRESH_URL = 'https://duplicati-oauth-handler.appspot.com/refresh';

/**
 * The Google Drive folder backups land in when the user leaves the field blank.
 * A blank setting still means "back up here" — so the dashboard shows this
 * value rather than an empty box, and `toDuplicatiUrl` falls back to it.
 */
export const DEFAULT_BACKUP_FOLDER = 'homelab-backups';

/**
 * Destinations come in two families, and the difference is structural:
 *
 *   MOUNTED   disk / smb / nfs — the kernel mounts them, Docker's local driver
 *             does the work, and Duplicati just sees a directory. Testable here
 *             by mounting and writing.
 *   BACKEND   googledrive / ftp / ftps — no kernel filesystem is mounted.
 *             Duplicati speaks the protocol itself via a target URL, so there
 *             is nothing to mount and nothing this process writes to directly;
 *             the destination is tested and provisioned through Duplicati.
 *
 * FTP reuses the SMB/NFS fields — `server` (host, or `host:port`), `share`
 * (the remote directory), `username`, `password` — because a mount and an
 * `aftp://` URL need the same four facts.
 */
export type BackupTargetKind = 'disk' | 'smb' | 'nfs' | 'googledrive' | 'ftp' | 'ftps';

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
  if (kind !== 'disk' && kind !== 'smb' && kind !== 'nfs' && kind !== 'googledrive' && kind !== 'ftp' && kind !== 'ftps') {
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
  if (target.kind === 'ftp' || target.kind === 'ftps') {
    // Duplicati's `aftp://` backend is the FluentFTP one — the maintained
    // implementation, and the only one that handles passive mode and TLS
    // reliably. `server` may carry a `host:port`; it drops straight into the
    // authority. The remote directory is `share`, same field SMB/NFS use.
    const dir = target.share.trim().replace(/^\/+|\/+$/g, '');
    // Built by hand rather than with URLSearchParams: that encodes a space as
    // `+`, and Duplicati's URL parser takes `+` literally, so a password with
    // a space would be sent wrong. encodeURIComponent uses `%20`.
    const params: string[] = [];
    if (target.username) params.push(`auth-username=${encodeURIComponent(target.username)}`);
    if (target.password) params.push(`auth-password=${encodeURIComponent(target.password)}`);
    // Explicit FTPS (AUTH TLS on the control channel) for `ftps`; plain FTP
    // otherwise. Duplicati's default is no encryption, so `ftp` needs nothing.
    if (target.kind === 'ftps') params.push('aftp-encryption-mode=Explicit');
    const query = params.length ? `?${params.join('&')}` : '';
    return `aftp://${target.server.trim()}/${encodeURI(dir)}${query}`;
  }

  if (target.kind !== 'googledrive') return null;
  const folder = target.folder.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_BACKUP_FOLDER;

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

/** The local directory Kopia keeps its repository in when nothing else fits. */
export const KOPIA_LOCAL_REPOSITORY_DEVICE = './data/repository';

export interface KopiaRepositoryMount {
  /** Docker local-driver options for Kopia's `/repository` volume. */
  spec: BackupMountSpec;
  /**
   * false → `spec` is the local fallback, not the chosen destination. The
   * caller should surface `reason` so the operator knows Kopia is not yet
   * writing offsite.
   */
  supported: boolean;
  /** Why the destination could not be translated. null when supported. */
  reason: string | null;
}

/**
 * Translate a saved destination into the mount for Kopia's `/repository`.
 *
 * Kopia's `filesystem` repository is just a directory, so a MOUNTED
 * destination (disk/smb/nfs) is translated exactly like Duplicati's — the
 * kernel mounts it, Kopia writes the repository into it.
 *
 * A BACKEND destination has no clean equivalent: Kopia's own remote backends
 * (S3/B2/GCS/Azure/SFTP/WebDAV/rclone) want different credentials and
 * protocols than the OAuth AuthID / FTP fields stored here, and Kopia has no
 * plain-FTP backend at all. So for googledrive/ftp/ftps this returns the
 * local fallback with `supported: false` rather than a spec that would fail at
 * mount time. Wiring a Kopia-native remote backend is its own task.
 */
export function toKopiaRepositoryMount(target: BackupTarget): KopiaRepositoryMount {
  if (isMountedKind(target.kind)) {
    return { spec: toMountSpec(target), supported: true, reason: null };
  }
  const label = target.kind === 'googledrive' ? 'Google Drive' : target.kind.toUpperCase();
  return {
    spec: { type: 'none', o: 'bind', device: KOPIA_LOCAL_REPOSITORY_DEVICE },
    supported: false,
    reason:
      `Kopia cannot use a ${label} destination yet, so it keeps a local repository ` +
      `on this host. Duplicati still writes to ${label}; a Kopia-native remote ` +
      `backend is a separate step.`,
  };
}

/** Human-readable validation. Returns null when the target is usable. */
export function validateTarget(target: BackupTarget): string | null {
  // A comma in a credential corrupts the comma-separated mount options — but
  // only for a mount. FTP credentials go into a URL, percent-encoded, where a
  // comma is fine, so this check does not apply to them.
  if (isMountedKind(target.kind)) {
    for (const [name, value] of [['username', target.username], ['password', target.password]] as const) {
      if (value.includes(',')) {
        return `The ${name} cannot contain a comma — mount options are comma-separated, so it would corrupt the mount.`;
      }
    }
  }

  if (target.kind === 'ftp' || target.kind === 'ftps') {
    if (!target.server) return 'Enter the FTP server hostname or IP address (add `:port` if it is not 21).';
    // server, username and password land in an aftp:// URL. A space or a URL
    // metacharacter in the host would split it; credentials are percent-encoded
    // so they are unrestricted.
    if (/[\s/?#@]/.test(target.server)) {
      return 'The server must be a bare host or host:port — no slashes, spaces or credentials.';
    }
    return null;
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
