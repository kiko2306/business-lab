// Settings routes: Alert categories, their ntfy topics, and the test send.
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { writeAuditLog } from '../../utils/audit';
import {
  ALERT_CATEGORIES,
  AlertSource,
  appsToApplyAlertSettings,
  getAlertNotifyConfig,
  isValidAlertTopic,
  setAlertCategoryEnabled,
  setAlertCategoryTopic,
} from '../../utils/alertNotify';
import { restartService } from '../../services/executor';
import logger from '../../utils/logger';
import { getService } from '../../config/services';
import { runAlertTest } from '../../services/alertTest';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings/alerts — the shared ntfy alert topic + per-source flags
// ---------------------------------------------------------------------------
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    return res.json(await getAlertNotifyConfig());
  } catch {
    return res.status(500).json({ error: 'Unable to load alert settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/alerts — set a category's topic and/or enabled flag
// (§609: no more shared default topic, no separate Enforcement switch).
// A CrowdSec change takes effect on the next CrowdSec (re)start:
// services/crowdsecConfig.ts re-renders profiles.yaml + notifications/http.yaml.
// ---------------------------------------------------------------------------
router.put('/alerts', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  // { topics: { crowdsec?: string, 'critical-service'?: string, ... } }.
  // An empty string clears that category's override back to DEFAULT_ALERT_TOPIC.
  const topicsBody: Record<string, unknown> = typeof body.topics === 'object' && body.topics !== null ? body.topics : {};
  const changedTopics = Object.keys(topicsBody) as AlertSource[];
  // { enabled: { crowdsec?: boolean, ... } }.
  const enabledBody: Record<string, unknown> = typeof body.enabled === 'object' && body.enabled !== null ? body.enabled : {};
  const changedEnabled = Object.keys(enabledBody) as AlertSource[];

  if (!changedTopics.length && !changedEnabled.length) {
    return res.status(400).json({ error: 'Provide "topics" and/or "enabled".' });
  }
  for (const category of changedTopics) {
    if (!ALERT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Unknown alert category "${category}".` });
    }
    const value = topicsBody[category];
    if (value !== '' && !isValidAlertTopic(value)) {
      return res.status(400).json({
        error: `"${category}" topic must be empty (to clear it) or 1–64 characters: letters, digits, hyphens and underscores only.`,
      });
    }
  }
  for (const category of changedEnabled) {
    if (!ALERT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Unknown alert category "${category}".` });
    }
    if (typeof enabledBody[category] !== 'boolean') {
      return res.status(400).json({ error: `"${category}" enabled must be true or false.` });
    }
  }

  try {
    for (const category of changedTopics) {
      await setAlertCategoryTopic(category, topicsBody[category] as string);
    }
    for (const category of changedEnabled) {
      await setAlertCategoryEnabled(category, enabledBody[category] as boolean);
    }
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'ntfy_alerts',
      result: 'success',
      metadata: {
        ...(changedTopics.length ? { topics: topicsBody } : {}),
        ...(changedEnabled.length ? { enabled: enabledBody } : {}),
      },
    });

    // Apply now, not "on the next restart" (§532). Each of these settings is
    // rendered into its app's config only when that app starts, and saving
    // used to stop at "Restart CrowdSec to apply" (n8n wasn't even
    // mentioned). The next restart was a host reboot, which re-uses the stale
    // files, so alerts stayed off for days (§531). restartService re-renders
    // and recreates, and leaves an app that isn't running alone: its next
    // start renders the same config.
    const restarted: string[] = [];
    const notRunning: string[] = [];
    const failed: string[] = [];
    const appsToApply = appsToApplyAlertSettings({
      crowdsecTopic: changedTopics.includes('crowdsec'),
      criticalServiceTopic: changedTopics.includes('critical-service'),
      crowdsec: changedEnabled.includes('crowdsec'),
    });
    for (const app of appsToApply) {
      const label = getService(app)?.label ?? app;
      try {
        const result = await restartService(app, req.user!.id);
        (result.message.includes('not currently running') ? notRunning : restarted).push(label);
      } catch (error) {
        logger.error(`Applying alert settings: restart of ${app} failed`, { error: (error as { message?: string }).message });
        failed.push(label);
      }
    }

    const saved = await getAlertNotifyConfig();
    const parts = ['Saved.'];
    if (restarted.length) parts.push(`Applied: restarted ${restarted.join(', ')}.`);
    if (notRunning.length) parts.push(`${notRunning.join(', ')} not running; applies when started.`);
    if (failed.length) parts.push(`Could not restart ${failed.join(', ')}; restart it from Apps to apply.`);
    if (saved.enabled.crowdsec && changedEnabled.includes('crowdsec')) {
      parts.push('Subscribe to the topic in ntfy to receive pushes.');
    }
    return res.json({ ...saved, applied: failed.length === 0, message: parts.join(' ') });
  } catch {
    return res.status(500).json({ error: 'Unable to save alert settings.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/alerts/test — fire a sample alert down one source's path
// ---------------------------------------------------------------------------
router.post('/alerts/test', async (req: Request, res: Response) => {
  const source = req.body?.source;
  if (!ALERT_CATEGORIES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${ALERT_CATEGORIES.join(', ')}.` });
  }

  const result = await runAlertTest(source as AlertSource);
  await writeAuditLog({
    userId: req.user?.id ?? null,
    action: 'settings_change',
    resource: 'ntfy_alerts_test',
    result: result.ok ? 'success' : 'failure',
    metadata: { source },
  });

  return res.status(result.ok ? 200 : 502).json(result);
});

export default router;
