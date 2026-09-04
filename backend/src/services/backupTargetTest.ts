/**
 * Proves a chosen backup destination actually works before Save commits to
 * it — for disk/SMB/NFS, by mounting it and writing to it; for s3 (§221,
 * no kernel mount involved), by asking Kopia itself to connect.
 *
 * A destination that is only exercised when a backup runs is a destination you
 * discover is broken on the day you need it. Wrong SMB credentials, an export
 * not shared to this host, a NAS that is up but read-only — none of those show
 * up until something tries to write, so this does exactly that, then cleans up.
 */

import { spawn } from 'child_process';
import { BackupMountSpec, BackupTarget, S3ConnectArgs, toMountSpec, toS3ConnectArgs } from '../utils/backupTarget';
import { readKopiaRepositoryPassword } from './kopiaTargetApply';
import logger from '../utils/logger';

const PROBE_VOLUME = 'homelab-backup-target-probe';
const TIMEOUT_MS = 20_000;
// A repository connect/create round trip over the network needs more room
// than a local mount+write.
const S3_TIMEOUT_MS = 30_000;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], timeoutMs = TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export interface BackupTargetTestResult {
  success: boolean;
  message: string;
  detail: string;
}

/** Dispatches to the mount-based test or the s3 one — see the file doc comment. */
export async function testBackupTarget(target: BackupTarget): Promise<BackupTargetTestResult> {
  if (target.kind === 's3') {
    return testS3Target(toS3ConnectArgs(target));
  }
  return testMountTarget(toMountSpec(target));
}

/**
 * Create a throwaway volume with the same options the real one will use,
 * write a file through it, and remove it again.
 *
 * Creating the volume proves nothing on its own — Docker accepts the options
 * without touching the network and only mounts on first use. So the write is
 * the actual test, and the volume is created with a probe name so a failure
 * never leaves the real backup volume in a bad state.
 */
async function testMountTarget(spec: BackupMountSpec): Promise<BackupTargetTestResult> {
  await run('docker', ['volume', 'rm', '-f', PROBE_VOLUME]);

  const create = await run('docker', [
    'volume', 'create',
    '--driver', 'local',
    '--opt', `type=${spec.type}`,
    '--opt', `o=${spec.o}`,
    '--opt', `device=${spec.device}`,
    PROBE_VOLUME,
  ]);

  if (create.code !== 0) {
    return {
      success: false,
      message: 'Could not define the destination.',
      detail: (create.stderr || create.stdout).trim().slice(0, 400),
    };
  }

  // Mounting happens here, not at create time — this is where a wrong password
  // or an unreachable server actually surfaces.
  const write = await run('docker', [
    'run', '--rm', '-v', `${PROBE_VOLUME}:/probe`, 'alpine:latest',
    'sh', '-c', 'touch /probe/.homelab-write-test && rm -f /probe/.homelab-write-test && echo WRITE-OK',
  ]);

  await run('docker', ['volume', 'rm', '-f', PROBE_VOLUME]);

  if (write.code === 0 && write.stdout.includes('WRITE-OK')) {
    return {
      success: true,
      message: 'Destination mounted and is writable.',
      detail: `${spec.type === 'none' ? 'Local path' : spec.type.toUpperCase()} ${spec.device}`,
    };
  }

  const raw = (write.stderr || write.stdout).trim();
  logger.warn('Backup destination test failed', { detail: raw.slice(0, 200) });

  // The kernel's mount errors are terse and get misread constantly — a wrong
  // SMB password and an unshared export both surface as "permission denied".
  let hint = '';
  if (/permission denied/i.test(raw)) {
    hint = spec.type === 'cifs'
      ? ' Check the username and password, and that the share allows this host.'
      : ' Check the export allows this host, and that it is exported read-write.';
  } else if (/no such (file|device)|not found/i.test(raw)) {
    hint = spec.type === 'none'
      ? ' That path does not exist on the host — create it first, or pick another.'
      : ' Check the server address and the share or export path.';
  } else if (/timed out|no route|unreachable/i.test(raw)) {
    hint = ' The server did not respond — check the address and that it is reachable from this host.';
  } else if (/invalid argument/i.test(raw)) {
    hint = ' The mount options were rejected — an SMB version mismatch is the usual cause.';
  }

  return {
    success: false,
    message: 'Could not write to the destination.',
    detail: (raw.slice(0, 400) || 'The mount failed with no output.') + hint,
  };
}

/**
 * Run the exact command Kopia's own entrypoint runs (`kopia repository
 * connect s3`), in a throwaway `kopia/kopia` container, and read its verdict.
 *
 * There is no lightweight "just check the bucket" mode — `connect` either
 * finds a repository or it doesn't — so the result is read from Kopia's own
 * error text, the same terse-error-parsing trade the mount test already
 * makes for kernel mount errors. Confirmed empirically against a throwaway
 * MinIO instance (plan.md §221): valid credentials + an existing, empty
 * bucket give the exact message matched below; a wrong secret key gives a
 * distinct signature-mismatch error; an unreachable endpoint times out.
 *
 * One known gap, same class as "a wrong SMB share name reads as permission
 * denied": a bucket that does not exist at all gives the *same* "not
 * initialized" message as a real, empty, reachable bucket — S3's own API
 * doesn't distinguish "bucket missing" from "bucket empty" without a create
 * attempt, and this test deliberately never creates anything (Save is what
 * commits to that). A typo'd bucket name will report as a working
 * destination and only actually fail once a real backup tries to create the
 * repository against it.
 */
async function testS3Target(s3: S3ConnectArgs): Promise<BackupTargetTestResult> {
  if (!s3.bucket || !s3.accessKeyId) {
    return { success: false, message: 'Enter a bucket and access key first.', detail: '' };
  }

  // The same password Kopia's own entrypoint will use — required, not just
  // a throwaway to satisfy argument parsing: an s3 target that already holds
  // a repository (re-testing an already-applied destination, or a bucket
  // shared with a previous install) can only be read with this exact
  // password, so a made-up one would misreport a real, working destination
  // as broken. Falls back to a throwaway when Kopia isn't installed yet or
  // has no password of its own — connecting to a genuinely empty bucket
  // doesn't need the real one to prove reachability + credentials.
  const password = readKopiaRepositoryPassword() || 'homelab-backup-target-test';

  const args = [
    'run', '--rm', '--entrypoint', 'kopia', 'kopia/kopia:latest',
    'repository', 'connect', 's3',
    `--bucket=${s3.bucket}`,
    `--access-key=${s3.accessKeyId}`,
    `--secret-access-key=${s3.secretAccessKey}`,
    `--password=${password}`,
  ];
  if (s3.endpoint) args.push(`--endpoint=${s3.endpoint}`);
  // Same raw-passthrough contract as the mount options field — word split
  // deliberately, so e.g. `--region=us-east-1 --disable-tls` becomes two
  // flags.
  if (s3.extraArgs) args.push(...s3.extraArgs.split(/\s+/).filter(Boolean));

  const result = await run('docker', args, S3_TIMEOUT_MS);
  const raw = (result.stderr || result.stdout).trim();

  if (result.code === 0 || /repository not initialized/i.test(raw)) {
    return {
      success: true,
      message: 'Bucket reachable and credentials accepted.',
      detail: result.code === 0
        ? `A repository already exists at ${s3.bucket}.`
        : `${s3.bucket} is empty — Kopia will create a repository there on Save.`,
    };
  }

  logger.warn('S3 backup destination test failed', { detail: raw.slice(0, 200) });

  let hint = '';
  if (/signature.*does not match|invalid access key|access denied|forbidden/i.test(raw)) {
    hint = ' Check the access key ID and secret access key.';
  } else if (/dial tcp|timed out|no such host|i\/o timeout|connection refused/i.test(raw)) {
    hint = ' The endpoint did not respond — check it, and that this host can reach it (a plain-HTTP endpoint like a LAN MinIO also needs --disable-tls in the extra flags).';
  } else if (/no such bucket|bucket.*not exist/i.test(raw)) {
    hint = ' That bucket does not exist — create it first, or check the name.';
  }

  return {
    success: false,
    message: 'Could not connect to the bucket.',
    detail: (raw.slice(0, 400) || 'Kopia gave no output.') + hint,
  };
}
