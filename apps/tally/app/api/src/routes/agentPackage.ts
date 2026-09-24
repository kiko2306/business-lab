import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAdmin } from '../auth';

/**
 * Serves the shop agent's Windows setup, one exe built at image-build time
 * (plan.md §670). The Dockerfile publishes the agent and writes `agent.json`
 * beside it, so the version shown here is the version of the very file that is
 * downloaded — there is no second place for them to drift apart.
 *
 * Admin-only, like enrolment codes: installing an agent is an admin task, and
 * the exe itself holds nothing secret (no token, no URL).
 */
export function agentPackageRoutes(dir: string): Router {
  const router = Router();

  const read = (): { version: string; file: string } | null => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'agent.json'), 'utf8'));
      return typeof meta.version === 'string' && typeof meta.file === 'string' ? meta : null;
    } catch {
      // No package built into this image (tests, `ng serve` development).
      return null;
    }
  };

  router.get('/agent-package', requireAdmin, (_req, res) => {
    const meta = read();
    if (!meta) {
      res.status(404).json({ error: 'no agent package in this build' });
      return;
    }
    res.json(meta);
  });

  router.get('/agent-package/download', requireAdmin, (_req, res) => {
    const meta = read();
    if (!meta) {
      res.status(404).json({ error: 'no agent package in this build' });
      return;
    }
    // basename: the name comes from a file we wrote, but never let a path
    // escape the directory regardless.
    res.download(path.join(dir, path.basename(meta.file)), path.basename(meta.file));
  });

  return router;
}
