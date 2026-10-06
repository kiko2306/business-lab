import { HealthStatus } from './models';
import { summarizeHealth } from './health-summary';
import { en } from '../i18n/en';
import { ptPT } from '../i18n/pt-pt';

// plan.md §841 fix 1: the health read-out says state in words and a bar, in
// whole sentences per metric — never `ok`/`degraded`, never a lowercased
// concatenation of fragments.
const tFor = (dict: Record<string, string>) => (key: string, params?: Record<string, string | number>) => {
  let value = dict[key] ?? key;
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replace(`{{${name}}}`, String(replacement));
  return value;
};
const t = tFor(en);

const health = (extra: Partial<HealthStatus> = {}): HealthStatus => ({
  status: 'ok',
  database: 'ok',
  disks: [{ name: 'docker', path: '/', percentUsed: 20, totalBytes: 500e9, usedBytes: 100e9, availableBytes: 400e9 }],
  cpu: { percentUsed: 13 },
  memory: { percentUsed: 42, totalBytes: 16 * 1024 ** 3, usedBytes: 6.72 * 1024 ** 3 },
  load: { oneMinute: 0.5, loadPerCpu: 0.25 },
  thresholds: { diskPercent: 85, memoryPercent: 90, loadPerCpu: 1.5 },
  alerts: [],
  timestamp: '2026-10-06T10:00:00Z',
  ...extra,
});

describe('summarizeHealth', () => {
  it('says everything is normal when nothing alerts', () => {
    const s = summarizeHealth(health(), t);
    expect(s.ok).toBeTrue();
    expect(s.headline).toBe('Everything is running normally.');
    expect(s.rows.map((r) => r.key)).toEqual(['database', 'disk', 'memory', 'load']);
    expect(s.rows.every((r) => r.ok)).toBeTrue();
  });

  it('shows free space with the same units as the header strip (GB disk, GiB memory)', () => {
    const s = summarizeHealth(health(), t);
    expect(s.rows.find((r) => r.key === 'disk')?.detail).toBe('400 GB free of 500 GB');
    expect(s.rows.find((r) => r.key === 'memory')?.detail).toBe('9.3 GiB free of 16.0 GiB');
  });

  it('names a breaching disk in a whole sentence and marks only that row', () => {
    const s = summarizeHealth(
      health({
        status: 'degraded',
        disks: [{ name: 'docker', path: '/', percentUsed: 91, totalBytes: 500e9, usedBytes: 455e9, availableBytes: 45e9 }],
        alerts: [{ metric: 'disk', value: 91, threshold: 85 }],
      }),
      t
    );
    expect(s.ok).toBeFalse();
    expect(s.headline).toBe('Disk space is running low: 91% full.');
    expect(s.rows.filter((r) => !r.ok).map((r) => r.key)).toEqual(['disk']);
  });

  it('labels two filesystems apart and alerts the right one', () => {
    const s = summarizeHealth(
      health({
        status: 'degraded',
        disks: [
          { name: 'docker', path: '/d', percentUsed: 93, totalBytes: 500e9, usedBytes: 465e9, availableBytes: 35e9 },
          { name: 'system', path: '/', percentUsed: 30, totalBytes: 200e9, usedBytes: 60e9, availableBytes: 140e9 },
        ],
        alerts: [{ metric: 'disk:docker', value: 93, threshold: 85 }],
      }),
      t
    );
    const disks = s.rows.filter((r) => r.key === 'disk');
    expect(disks.map((r) => r.label)).toEqual(['Apps storage', 'System disk']);
    expect(disks.map((r) => r.ok)).toEqual([false, true]);
    expect(s.headline).toBe('Apps storage is running low: 93% full.');
  });

  it('joins several alerts as separate sentences, each capitalised', () => {
    const s = summarizeHealth(
      health({
        status: 'degraded',
        alerts: [
          { metric: 'memory', value: 95, threshold: 90 },
          { metric: 'load', value: 1.8, threshold: 1.5 },
        ],
      }),
      t
    );
    expect(s.headline).toBe('Memory is running low: 95% in use. The server is under heavy load.');
  });

  it('describes load in words, not a per-CPU ratio', () => {
    const word = (loadPerCpu: number) =>
      summarizeHealth(health({ load: { oneMinute: 1, loadPerCpu } }), t).rows.find((r) => r.key === 'load')?.detail;
    expect(word(0.2)).toBe('Light');
    expect(word(1.0)).toBe('Moderate');
    expect(word(1.6)).toBe('Heavy');
  });

  it('flags an unreachable database even though the API does not alert on it', () => {
    const s = summarizeHealth(health({ database: 'error' }), t);
    expect(s.ok).toBeFalse();
    expect(s.headline).toBe('The business database is not responding.');
    expect(s.rows.find((r) => r.key === 'database')?.ok).toBeFalse();
  });

  it('falls back to a generic sentence for a metric it does not know', () => {
    const s = summarizeHealth(health({ status: 'degraded', alerts: [{ metric: 'gpu', value: 1, threshold: 0 }] }), t);
    expect(s.headline).toBe('Something needs attention.');
  });

  it('reads in pt-PT without leaking the API words or English', () => {
    const s = summarizeHealth(
      health({ status: 'degraded', alerts: [{ metric: 'disk', value: 91, threshold: 85 }] }),
      tFor(ptPT)
    );
    expect(s.headline).not.toMatch(/degraded|\bok\b|running low/i);
    expect(s.rows.map((r) => r.label).join(' ')).not.toMatch(/Disk space|Memory|Server load/);
  });

  it('has every home.health.* string in both languages', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('home.health.'))) {
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
