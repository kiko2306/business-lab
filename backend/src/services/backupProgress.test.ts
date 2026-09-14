import { describe, expect, it } from 'vitest';
import {
  finishBackupProgress,
  getBackupProgress,
  reportBackupStep,
  setBackupPhase,
  startBackupProgress,
} from './backupProgress';

describe('backupProgress', () => {
  it('walks through dumping -> snapshotting -> done', () => {
    startBackupProgress('manual');
    expect(getBackupProgress()).toMatchObject({ running: true, trigger: 'manual', phase: 'dumping', index: 0 });

    reportBackupStep(1, 3, 'itflow');
    expect(getBackupProgress()).toMatchObject({ index: 1, total: 3, label: 'itflow' });

    reportBackupStep(3, 3, 'SQLite databases');
    setBackupPhase('snapshotting');
    expect(getBackupProgress()).toMatchObject({ phase: 'snapshotting', label: null });

    finishBackupProgress(true, 'triggered a Kopia snapshot');
    const finished = getBackupProgress();
    expect(finished).toMatchObject({
      running: false,
      phase: 'done',
      ok: true,
      detail: 'triggered a Kopia snapshot',
    });
    expect(finished.finishedAt).not.toBeNull();
  });

  it('starts fresh on every run, discarding the previous one\'s numbers', () => {
    startBackupProgress('scheduled');
    reportBackupStep(2, 5, 'kimai');
    finishBackupProgress(false, 'boom');

    startBackupProgress('manual');
    expect(getBackupProgress()).toMatchObject({ trigger: 'manual', phase: 'dumping', index: 0, total: 0, label: null });
  });
});
