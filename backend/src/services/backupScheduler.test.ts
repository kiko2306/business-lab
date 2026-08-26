import { describe, expect, it } from 'vitest';
import { shouldRunScheduledBackup } from './backupScheduler';

describe('shouldRunScheduledBackup', () => {
  it('runs immediately when there is no prior run', () => {
    expect(shouldRunScheduledBackup(new Date('2026-08-26T12:00:00Z'), null, 'daily')).toBe(true);
  });

  it('runs immediately when the stored last-run value is unparseable', () => {
    expect(shouldRunScheduledBackup(new Date('2026-08-26T12:00:00Z'), 'not-a-date', 'daily')).toBe(true);
  });

  it('does not run daily backups before 24 hours have elapsed', () => {
    const lastRunAt = '2026-08-26T00:00:00Z';
    const now = new Date('2026-08-26T23:59:00Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'daily')).toBe(false);
  });

  it('runs daily backups once 24 hours have elapsed', () => {
    const lastRunAt = '2026-08-26T00:00:00Z';
    const now = new Date('2026-08-27T00:00:01Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'daily')).toBe(true);
  });

  it('does not run weekly backups before 7 days have elapsed', () => {
    const lastRunAt = '2026-08-20T00:00:00Z';
    const now = new Date('2026-08-26T23:59:00Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'weekly')).toBe(false);
  });

  it('runs weekly backups once 7 days have elapsed', () => {
    const lastRunAt = '2026-08-19T00:00:00Z';
    const now = new Date('2026-08-26T00:00:01Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'weekly')).toBe(true);
  });
});
