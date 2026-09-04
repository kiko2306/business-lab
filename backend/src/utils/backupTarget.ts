/**
 * Where backups are written: another disk, a NAS, a network drive, or (§221)
 * an S3-compatible bucket Kopia talks to directly.
 *
 * The whole point is that a backup living on the same disk as the data does
 * not survive the failure that matters most.
 *
 * `disk`/`smb`/`nfs` are expressed as ONE volume shape, because Docker's
 * local driver takes the same three options for each:
 *
 *   disk  type=none  o=bind                     device=/mnt/backups
 *   nfs   type=nfs   o=addr=10.0.0.5,rw         device=:/volume1/backup
 *   smb   type=cifs  o=username=x,password=y,…  device=//10.0.0.5/backup
 *
 * `s3` is a different shape entirely — Kopia connects to it directly over
 * the network (`kopia repository connect s3 …`), no kernel mount involved —
 * so it reuses the same five form fields with different meanings rather than
 * inventing new ones: `server` is the endpoint (blank = AWS), `share` is the
 * bucket, `username`/`password` are the access key ID / secret access key,
 * and `options` is raw extra `kopia repository connect s3` flags (e.g.
 * `--region=us-east-1` or `--disable-tls` for a plain-HTTP endpoint like a
 * LAN MinIO) — the same "escape hatch, appended verbatim" role `options`
 * already plays for SMB/NFS mount options.
 *
 * Google Drive and FTP/FTPS destinations existed here while Duplicati was the
 * backup engine (plan.md §81.5) — Duplicati spoke those protocols directly,
 * with no kernel filesystem to mount. Removing Duplicati (§196) removed them
 * too: Kopia has no plain-FTP backend and its `gdrive` backend needs a GCP
 * service-account JSON, not an OAuth AuthID, so there was nothing left to
 * translate them into. B2/SFTP/`gdrive` are still open (§194) — S3 is the
 * first Kopia-native remote, done at §221 because it's also how you talk to
 * B2 and most NAS/on-prem object storage (MinIO, etc) — a real S3 endpoint
 * isn't the only thing "S3" buys here.
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
} as const;

export type BackupTargetKind = 'disk' | 'smb' | 'nfs' | 's3';

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
  if (kind !== 'disk' && kind !== 'smb' && kind !== 'nfs' && kind !== 's3') {
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
  };
}

/**
 * Translate a target into the three Docker local-driver options.
 *
 * Mount options are joined with commas, so a value containing one would be
 * read as a separate option — a password with a comma in it would silently
 * mangle the mount rather than fail. Rejected up front instead.
 *
 * `s3` has no mount at all — call `toS3ConnectArgs` for that kind instead.
 */
export function toMountSpec(target: BackupTarget): BackupMountSpec {
  if (target.kind === 's3') {
    throw new Error('toMountSpec does not apply to an s3 target — use toS3ConnectArgs.');
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
  // Files land owned by Kopia's container user, or it cannot write.
  if (!/uid=/.test(extra)) parts.push('uid=1000', 'gid=1000');
  if (extra) parts.push(extra);

  const share = target.share.replace(/^\/+/, '');
  return { type: 'cifs', o: parts.join(','), device: `//${target.server}/${share}` };
}

/** The local directory Kopia keeps its repository in before any destination is chosen. */
export const KOPIA_LOCAL_REPOSITORY_DEVICE = './data/repository';

/**
 * Translate a saved destination into the mount for Kopia's `/repository`.
 *
 * Kopia's `filesystem` repository is just a directory, so this is a straight
 * `toMountSpec` — the kernel mounts the destination, Kopia writes the
 * repository into it.
 */
export function toKopiaRepositoryMount(target: BackupTarget): BackupMountSpec {
  return toMountSpec(target);
}

/**
 * Translate an `s3` destination into the flags `kopia repository connect s3`
 * / `create s3` take. No kernel mount involved — Kopia talks to the bucket
 * over HTTPS itself, which is also why there is no `BackupMountSpec` here.
 */
export interface S3ConnectArgs {
  /** Bucket name. */
  bucket: string;
  /** Custom endpoint (MinIO, B2, Wasabi, …). Blank connects to AWS S3. */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Raw extra flags, e.g. `--region=us-east-1` or `--disable-tls`. */
  extraArgs: string;
}

export function toS3ConnectArgs(target: BackupTarget): S3ConnectArgs {
  return {
    bucket: target.share,
    endpoint: target.server,
    accessKeyId: target.username,
    secretAccessKey: target.password,
    extraArgs: target.options.trim(),
  };
}

/** Human-readable validation. Returns null when the target is usable. */
export function validateTarget(target: BackupTarget): string | null {
  // A comma in a credential corrupts the comma-separated mount options —
  // moot for s3 (no comma-joined option string) but harmless to keep general.
  for (const [name, value] of [['username', target.username], ['password', target.password]] as const) {
    if (target.kind !== 's3' && value.includes(',')) {
      return `The ${name} cannot contain a comma — mount options are comma-separated, so it would corrupt the mount.`;
    }
  }

  if (target.kind === 'disk') {
    if (!target.path.startsWith('/')) return 'Enter an absolute path, e.g. /mnt/backups.';
    // The whole point is surviving the loss of this disk.
    if (/^\/(home|root|var\/lib\/docker)(\/|$)/.test(target.path)) {
      return 'That path is on the system disk. Choose a separate disk or a network share, or the backup dies with the machine.';
    }
    return null;
  }

  if (target.kind === 's3') {
    if (!target.share) return 'Enter the bucket name.';
    if (!target.username) return 'Enter the access key ID.';
    return null;
  }

  if (!target.server) return 'Enter the NAS hostname or IP address.';
  if (!target.share) return target.kind === 'nfs' ? 'Enter the NFS export path, e.g. /volume1/backup.' : 'Enter the share name.';
  if (target.kind === 'smb' && !target.username) return 'Enter the username for the share.';
  return null;
}
