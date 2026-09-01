import { Router, Request, Response } from 'express';
import os from 'os';
import { execFile } from 'child_process';
import { query } from '../utils/database';
import { schemas, validateBody } from '../middleware/validation';

const router = Router();

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

async function getDisk(): Promise<DiskUsage> {
  return parseDfOutput(await runCommand('df', ['-Pk', '/']));
}

router.get('/thresholds', async (_req: Request, res: Response) => {
  try {
    return res.json(await getThresholds());
  } catch {
    return res.status(500).json({ error: 'Unable to load health thresholds.' });
  }
});

router.put('/thresholds', validateBody(schemas.healthThresholds), async (req: Request, res: Response) => {
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
    const [dbResult, thresholds, disk] = await Promise.all([
      query<{ ok: number }>('SELECT 1 AS ok'),
      getThresholds(),
      getDisk(),
    ]);

    const diskPercent = disk.percentUsed;
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const memoryPercent = Math.round((memUsed / memTotal) * 100);
    const oneMinuteLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length || 1;
    const loadPerCpu = oneMinuteLoad / cpuCount;

    const alerts: { metric: string; value: number; threshold: number }[] = [];
    if (diskPercent >= thresholds.diskPercent) {
      alerts.push({ metric: 'disk', value: diskPercent, threshold: thresholds.diskPercent });
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
      disk,
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
