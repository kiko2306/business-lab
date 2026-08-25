'use strict';

const { Router } = require('express');
const os = require('os');
const { execFile } = require('child_process');
const { query } = require('../utils/database');
const { schemas, validateBody } = require('../middleware/validation');

const router = Router();

const DEFAULT_THRESHOLDS = {
  diskPercent: 85,
  memoryPercent: 90,
  loadPerCpu: 1.5,
};

function runCommand(cmd, args) {
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

async function getThresholds() {
  const result = await query(
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

async function getDiskPercent() {
  const stdout = await runCommand('df', ['-Pk', '/']);
  const lines = stdout.trim().split('\n');
  const parts = lines[1]?.split(/\s+/) || [];
  const percentRaw = parts[4] || '0%';
  return Number.parseInt(percentRaw.replace('%', ''), 10) || 0;
}

router.get('/thresholds', async (_req, res) => {
  try {
    return res.json(await getThresholds());
  } catch {
    return res.status(500).json({ error: 'Unable to load health thresholds.' });
  }
});

router.put('/thresholds', validateBody(schemas.healthThresholds), async (req, res) => {
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

async function systemHealthHandler(_req, res) {
  try {
    const [dbResult, thresholds, diskPercent] = await Promise.all([
      query('SELECT 1 AS ok'),
      getThresholds(),
      getDiskPercent(),
    ]);

    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memoryPercent = Math.round(((memTotal - memFree) / memTotal) * 100);
    const oneMinuteLoad = os.loadavg()[0];
    const cpuCount = os.cpus().length || 1;
    const loadPerCpu = oneMinuteLoad / cpuCount;

    const alerts = [];
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
      disk: { percentUsed: diskPercent },
      memory: { percentUsed: memoryPercent },
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

module.exports = router;
