import { Router, Request, Response } from 'express';
import os from 'os';
import { execFile } from 'child_process';
import { query } from '../utils/database';
import { schemas, validateBody } from '../middleware/validation';
import { requireCapability } from '../middleware/requireCapability';

const router = Router();

/**
 * Cumulative CPU tick counts across all cores. CPU utilisation is a rate, not
 * a level, so it has to be measured as the change between two of these — one
 * snapshot on its own says nothing.
 */
function cpuSnapshot(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const value of Object.values(cpu.times)) {
      total += value;
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

// Updated on every read so the *next* read can diff against it. Seeded at
// module load; the first real read falls back to a short inline sample
// because too little time has passed for the diff to mean anything.
let lastCpu = cpuSnapshot();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Percent of CPU time spent non-idle. When reads are spaced out (the header
 * strip polls every ~30s) this is the average over that gap, computed for
 * free from the running tick counters. When called again too soon — or for
 * the first time after boot — it takes a fresh 150ms sample instead so a
 * near-zero interval can't produce a garbage number.
 */
async function readCpuPercent(): Promise<number> {
  const clamp = (fraction: number): number => Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const now = cpuSnapshot();
  const idleDelta = now.idle - lastCpu.idle;
  const totalDelta = now.total - lastCpu.total;
  // ~200 ticks/core (2s at 100Hz) is comfortably enough signal; below that,
  // sample directly.
  if (totalDelta > 200 * (os.cpus().length || 1)) {
    lastCpu = now;
    return clamp(1 - idleDelta / totalDelta);
  }
  await sleep(150);
  const after = cpuSnapshot();
  lastCpu = after;
  const sampledIdle = after.idle - now.idle;
  const sampledTotal = after.total - now.total;
  return sampledTotal > 0 ? clamp(1 - sampledIdle / sampledTotal) : 0;
}

interface Thresholds {
  diskPercent: number;
  memoryPercent: number;
  loadPerCpu: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  diskPercent: 85,
  memoryPercent: 90,
  loadPerCpu: 1.5,
};

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function getThresholds(): Promise<Thresholds> {
  const result = await query<{ key: string; value: string }>(
    'SELECT key, value FROM settings WHERE key IN ($1, $2, $3)',
    ['health_disk_threshold', 'health_memory_threshold', 'health_load_threshold']
  );

  const map = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    diskPercent: Number.parseFloat(map.health_disk_threshold ?? `${DEFAULT_THRESHOLDS.diskPercent}`),
    memoryPercent: Number.parseFloat(map.health_memory_threshold ?? `${DEFAULT_THRESHOLDS.memoryPercent}`),
    loadPerCpu: Number.parseFloat(map.health_load_threshold ?? `${DEFAULT_THRESHOLDS.loadPerCpu}`),
  };
}

export interface DiskUsage {
  percentUsed: number;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

/**
 * Parse `df -Pk /` output. The POSIX `-P` flag is what makes positional
 * indexing safe here: it guarantees one line per filesystem (no wrapping for a
 * long device name, which plain `df` does) and the fixed column order
 * Filesystem, 1024-blocks, Used, Available, Capacity, Mounted-on.
 *
 * percentUsed stays the capacity column rather than a used/total ratio we
 * compute ourselves: df reports capacity against the non-reserved space, so on
 * a filesystem with root-reserved blocks the two disagree by a few points, and
 * the capacity column is the number thresholds have always been compared
 * against.
 */
export function parseDfOutput(stdout: string): DiskUsage {
  const lines = stdout.trim().split('\n');
  const parts = lines[1]?.trim().split(/\s+/) || [];
  const kb = (index: number) => (Number.parseInt(parts[index], 10) || 0) * 1024;

  return {
    percentUsed: Number.parseInt((parts[4] || '0%').replace('%', ''), 10) || 0,
    totalBytes: kb(1),
    usedBytes: kb(2),
    availableBytes: kb(3),
  };
}

/**
 * Where the backend's own container root lives — which is Docker's data root,
 * because that is what backs the overlay. It follows a `data-root` move
 * automatically (§83.2), which is the point: it always measures the filesystem
 * images and volumes are actually piling up on.
 */
const DOCKER_DISK_PATH = '/';
/**
 * The host's root filesystem, bind-mounted read-only. Once Docker's storage
 * moves off the root LV, nothing else would be watching the filesystem holding
 * the OS and its logs — it would fill up with the dashboard reporting a
 * healthy figure for somewhere else entirely (§83.3).
 */
const SYSTEM_DISK_PATH = '/hostfs';

export interface NamedDiskUsage extends DiskUsage {
  name: string;
  path: string;
}

async function measureDisk(name: string, path: string): Promise<NamedDiskUsage | null> {
  try {
    return { name, path, ...parseDfOutput(await runCommand('df', ['-Pk', path])) };
  } catch {
    // /hostfs is absent in dev and in CI, where there is no host to mount.
    // A filesystem that cannot be measured is left out rather than reported
    // as 0% — an invented healthy number is worse than a missing row.
    return null;
  }
}

/**
 * Both filesystems worth watching, deduplicated by device size: before the
 * data-root move they are the same filesystem, and showing one row twice
 * would just look like a bug.
 */
export async function getDisks(): Promise<NamedDiskUsage[]> {
  const measured = await Promise.all([
    measureDisk('docker', DOCKER_DISK_PATH),
    measureDisk('system', SYSTEM_DISK_PATH),
  ]);
  return dedupeDisks(measured.filter((disk): disk is NamedDiskUsage => disk !== null));
}

export function dedupeDisks(disks: NamedDiskUsage[]): NamedDiskUsage[] {
  const seen = new Set<string>();
  return disks.filter((disk) => {
    // Same size and same used bytes means the same filesystem seen twice —
    // df reports the backing device, and a bind mount of / shares it.
    const key = `${disk.totalBytes}:${disk.usedBytes}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

router.get('/thresholds', async (_req: Request, res: Response) => {
  try {
    return res.json(await getThresholds());
  } catch {
    return res.status(500).json({ error: 'Unable to load health thresholds.' });
  }
});

router.put('/thresholds', requireCapability('settings:manage'), validateBody(schemas.healthThresholds), async (req: Request, res: Response) => {
  const { diskPercent, memoryPercent, loadPerCpu } = req.body;

  try {
    await Promise.all([
      query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        ['health_disk_threshold', String(diskPercent)]
      ),
      query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        ['health_memory_threshold', String(memoryPercent)]
      ),
      query(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        ['health_load_threshold', String(loadPerCpu)]
      ),
    ]);
    return res.json({ message: 'Health thresholds updated.' });
  } catch {
    return res.status(500).json({ error: 'Unable to update thresholds.' });
  }
});

async function systemHealthHandler(_req: Request, res: Response) {
  try {
    const [dbResult, thresholds, disks, cpuPercent] = await Promise.all([
      query<{ ok: number }>('SELECT 1 AS ok'),
      getThresholds(),
      getDisks(),
      readCpuPercent(),
    ]);

    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const memoryPercent = Math.round((memUsed / memTotal) * 100);
    const oneMinuteLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length || 1;
    const loadPerCpu = oneMinuteLoad / cpuCount;

    const alerts: { metric: string; value: number; threshold: number }[] = [];
    // One alert per filesystem, named, so "disk is at 91%" says which one.
    for (const disk of disks) {
      if (disk.percentUsed >= thresholds.diskPercent) {
        alerts.push({
          metric: disks.length > 1 ? `disk:${disk.name}` : 'disk',
          value: disk.percentUsed,
          threshold: thresholds.diskPercent,
        });
      }
    }
    if (memoryPercent >= thresholds.memoryPercent) {
      alerts.push({ metric: 'memory', value: memoryPercent, threshold: thresholds.memoryPercent });
    }
    if (loadPerCpu >= thresholds.loadPerCpu) {
      alerts.push({ metric: 'load', value: loadPerCpu, threshold: thresholds.loadPerCpu });
    }

    return res.json({
      status: alerts.length ? 'degraded' : 'ok',
      database: dbResult.rows[0]?.ok === 1 ? 'ok' : 'error',
      disks,
      cpu: { percentUsed: cpuPercent },
      memory: { percentUsed: memoryPercent, totalBytes: memTotal, usedBytes: memUsed },
      load: { oneMinute: oneMinuteLoad, loadPerCpu },
      thresholds,
      alerts,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return res.status(500).json({ error: 'Unable to run health checks.' });
  }
}

// `/` keeps the legacy /api/health contract working, while `/system` is the
// path used when the router is mounted at the root (where GET /health is the
// public liveness probe).
router.get('/', systemHealthHandler);
router.get('/system', systemHealthHandler);

export default router;
