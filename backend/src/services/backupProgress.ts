/**
 * Live progress for the app-data backup (dump-then-snapshot), so the
 * dashboard's "Full Backup" button can show a real step (which app, how many
 * to go) instead of an indeterminate spinner for the ~20s the dump takes.
 *
 * A single in-memory object, not a per-request or per-user thing: the dump
 * loop it tracks is process-wide and already serialised by
 * `withMaintenanceLock` (backupScheduler.ts), so there is only ever one run
 * to report on. Polled over plain HTTP (GET /api/backups/run/progress)
 * rather than a socket — this repo already has a WebSocket/SSE stream
 * (realtime.ts) for service status, but that broadcasts every 15s, too
 * coarse for a step that can finish in well under a second; a cheap poll
 * while a modal is open is simpler than a second stream for one screen.
 */

export type BackupProgressPhase = 'idle' | 'dumping' | 'snapshotting' | 'done';

export interface BackupProgress {
  running: boolean;
  trigger: 'scheduled' | 'manual' | null;
  phase: BackupProgressPhase;
  /** 1-based index of the step in progress (or last reached). */
  index: number;
  total: number;
  label: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  detail: string | null;
}

function idleState(): BackupProgress {
  return {
    running: false,
    trigger: null,
    phase: 'idle',
    index: 0,
    total: 0,
    label: null,
    startedAt: null,
    finishedAt: null,
    ok: null,
    detail: null,
  };
}

let state: BackupProgress = idleState();

export function getBackupProgress(): BackupProgress {
  return { ...state };
}

export function startBackupProgress(trigger: 'scheduled' | 'manual'): void {
  state = { ...idleState(), running: true, trigger, phase: 'dumping', startedAt: new Date().toISOString() };
}

export function reportBackupStep(index: number, total: number, label: string): void {
  state = { ...state, index, total, label };
}

export function setBackupPhase(phase: Exclude<BackupProgressPhase, 'idle' | 'done'>): void {
  state = { ...state, phase, label: null };
}

export function finishBackupProgress(ok: boolean, detail: string): void {
  state = { ...state, running: false, phase: 'done', ok, detail, finishedAt: new Date().toISOString() };
}
