/**
 * Proves a chosen backup destination actually works, by mounting it and
 * writing to it.
 *
 * A destination that is only exercised when a backup runs is a destination you
 * discover is broken on the day you need it. Wrong SMB credentials, an export
 * not shared to this host, a NAS that is up but read-only — none of those show
 * up until something tries to write, so this does exactly that, then cleans up.
 */

import { spawn } from 'child_process';
import { BackupMountSpec } from '../utils/backupTarget';
import logger from '../utils/logger';

const PROBE_VOLUME = 'homelab-backup-target-probe';
const TIMEOUT_MS = 20_000;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);

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

/**
 * Create a throwaway volume with the same options the real one will use,
 * write a file through it, and remove it again.
 *
 * Creating the volume proves nothing on its own — Docker accepts the options
 * without touching the network and only mounts on first use. So the write is
 * the actual test, and the volume is created with a probe name so a failure
 * never leaves the real backup volume in a bad state.
 */
export async function testBackupTarget(spec: BackupMountSpec): Promise<BackupTargetTestResult> {
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
