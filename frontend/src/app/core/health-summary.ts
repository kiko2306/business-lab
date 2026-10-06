import { formatGB, formatGiB } from './format-bytes';
import { DiskUsage, HealthStatus } from './models';

type T = (key: string, params?: Record<string, string | number>) => string;

export interface HealthRow {
  key: 'database' | 'disk' | 'memory' | 'load';
  label: string;
  /** False when this metric is the one that tripped (or the database is down). */
  ok: boolean;
  /** One plain line: free space, a load word, "Working". */
  detail: string;
  /** 0–100 for the bar; null where a bar means nothing (database, load). */
  percent: number | null;
}

export interface HealthSummary {
  ok: boolean;
  /** One sentence for the whole box, then one per alert — never the API's `ok`/`degraded`. */
  headline: string;
  rows: HealthRow[];
}

// The API alerts on `disk` while one filesystem is watched and on
// `disk:<name>` once two are, so match both.
const alertsDisk = (h: HealthStatus, disk: DiskUsage) =>
  h.alerts.some((a) => a.metric === 'disk' || a.metric === `disk:${disk.name}`);

const diskLabel = (h: HealthStatus, disk: DiskUsage, t: T) =>
  h.disks.length > 1 ? t(disk.name === 'docker' ? 'home.health.row.appsStorage' : 'home.health.row.systemDisk') : t('home.health.row.disk');

/**
 * The health payload as sentences and rows a non-technical owner can scan
 * (plan.md §841). Sentences are whole translated strings per metric: building
 * them from fragments and lowercasing is what broke pt-PT before.
 */
export function summarizeHealth(h: HealthStatus, t: T): HealthSummary {
  const databaseOk = h.database === 'ok';
  const loadRatio = h.load.loadPerCpu / h.thresholds.loadPerCpu;

  const rows: HealthRow[] = [
    {
      key: 'database',
      label: t('home.health.row.database'),
      ok: databaseOk,
      detail: t(databaseOk ? 'home.health.database.working' : 'home.health.database.down'),
      percent: null,
    },
    ...h.disks.map((disk): HealthRow => ({
      key: 'disk',
      label: diskLabel(h, disk, t),
      ok: !alertsDisk(h, disk),
      detail: t('home.health.freeOf', { free: formatGB(disk.availableBytes), total: formatGB(disk.totalBytes) }),
      percent: Math.round(disk.percentUsed),
    })),
    {
      key: 'memory',
      label: t('home.health.row.memory'),
      ok: !h.alerts.some((a) => a.metric === 'memory'),
      detail: t('home.health.freeOf', {
        free: formatGiB(h.memory.totalBytes - h.memory.usedBytes),
        total: formatGiB(h.memory.totalBytes),
      }),
      percent: Math.round(h.memory.percentUsed),
    },
    {
      key: 'load',
      label: t('home.health.row.load'),
      ok: !h.alerts.some((a) => a.metric === 'load'),
      // Half the alert threshold and up reads "Moderate": a hint that "Heavy" is next, not a fault.
      detail: t(loadRatio >= 1 ? 'home.health.load.heavy' : loadRatio >= 0.5 ? 'home.health.load.moderate' : 'home.health.load.light'),
      percent: null,
    },
  ];

  const sentences = h.alerts.map((a) => {
    const value = Math.round(a.value);
    switch (a.metric) {
      case 'disk:docker':
        return t('home.health.alert.appsStorage', { percent: value });
      case 'memory':
        return t('home.health.alert.memory', { percent: value });
      case 'load':
        return t('home.health.alert.load');
      default:
        return a.metric === 'disk' || a.metric.startsWith('disk:')
          ? t('home.health.alert.disk', { percent: value })
          : t('home.health.alert.other');
    }
  });
  if (!databaseOk) sentences.unshift(t('home.health.alert.database'));

  const ok = sentences.length === 0;
  return { ok, headline: ok ? t('home.health.allGood') : sentences.join(' '), rows };
}
