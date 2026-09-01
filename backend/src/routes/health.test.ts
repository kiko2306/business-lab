import { describe, expect, it } from 'vitest';
import { dedupeDisks, parseDfOutput } from './health';

describe('parseDfOutput', () => {
  // Verbatim `df -Pk /` from the host this runs on.
  const sample = [
    'Filesystem                        1024-blocks     Used Available Capacity Mounted on',
    '/dev/mapper/ubuntu--vg-ubuntu--lv   102626232 66127032  31239936      68% /',
  ].join('\n');

  it('reads the capacity column as the used percentage', () => {
    expect(parseDfOutput(sample).percentUsed).toBe(68);
  });

  it('converts the 1K block columns to bytes', () => {
    const disk = parseDfOutput(sample);
    expect(disk.totalBytes).toBe(102626232 * 1024);
    expect(disk.usedBytes).toBe(66127032 * 1024);
    expect(disk.availableBytes).toBe(31239936 * 1024);
  });

  it('does not derive the percentage from used/total', () => {
    // used/total is 64% here, but df reports 68% because capacity is measured
    // against the non-reserved space. The reported figure is the one the
    // thresholds have always compared against, so it has to win.
    const disk = parseDfOutput(sample);
    expect(Math.round((disk.usedBytes / disk.totalBytes) * 100)).toBe(64);
    expect(disk.percentUsed).toBe(68);
  });

  it('handles a device name long enough to wrap without -P', () => {
    const long = [
      'Filesystem                                        1024-blocks    Used Available Capacity Mounted on',
      '/dev/mapper/ubuntu--vg--with--a--long--name-lv-01     1000000  250000    750000      25% /',
    ].join('\n');
    const disk = parseDfOutput(long);
    expect(disk.percentUsed).toBe(25);
    expect(disk.totalBytes).toBe(1000000 * 1024);
  });

  it('returns zeroes rather than NaN for unusable output', () => {
    expect(parseDfOutput('')).toEqual({
      percentUsed: 0,
      totalBytes: 0,
      usedBytes: 0,
      availableBytes: 0,
    });
  });
});

describe('dedupeDisks', () => {
  const disk = (name: string, path: string, totalBytes: number, usedBytes: number) => ({
    name,
    path,
    percentUsed: Math.round((usedBytes / totalBytes) * 100),
    totalBytes,
    usedBytes,
    availableBytes: totalBytes - usedBytes,
  });

  it('collapses two views of the same filesystem into one row', () => {
    // Before Docker's data root moves, / and /hostfs are the same device, and
    // showing the identical numbers twice reads as a bug.
    const rows = dedupeDisks([
      disk('docker', '/', 105_000_000_000, 58_000_000_000),
      disk('system', '/hostfs', 105_000_000_000, 58_000_000_000),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('docker');
  });

  it('keeps both once they are genuinely different filesystems', () => {
    const rows = dedupeDisks([
      disk('docker', '/', 144_000_000_000, 57_000_000_000),
      disk('system', '/hostfs', 105_000_000_000, 10_000_000_000),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['docker', 'system']);
  });

  it('keeps a single row when only one filesystem could be measured', () => {
    // /hostfs is absent in dev and CI; one row is the correct answer there.
    expect(dedupeDisks([disk('docker', '/', 105_000_000_000, 58_000_000_000)])).toHaveLength(1);
  });
});
