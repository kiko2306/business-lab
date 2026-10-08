// Settings routes: Deployment checklist, timezone, dashboard URL and update branch.
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { writeAuditLog } from '../../utils/audit';
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UPDATE_BRANCH,
  getAppTimezone,
  getDashboardBaseUrl,
  getStoredDashboardUrl,
  getUpdateBranch,
  isValidBranchName,
  isValidDashboardUrl,
  isValidTimezone,
  setAppTimezone,
  setDashboardUrl,
  setUpdateBranch,
} from '../../utils/generalSettings';
import { getDeploymentStatus } from '../../services/deploymentStatus';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings/deployment — the per-client provisioning checklist
// (plan.md §357 P9a). Read-only; derived from the same settings the sections
// above read, so an operator provisioning a new box sees what is still blank.
// ---------------------------------------------------------------------------
router.get('/deployment', async (_req: Request, res: Response) => {
  try {
    return res.json(await getDeploymentStatus());
  } catch {
    return res.status(500).json({ error: 'Unable to load the deployment checklist.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/general — read general dashboard settings (timezone)
// ---------------------------------------------------------------------------
router.get('/general', async (_req: Request, res: Response) => {
  try {
    return res.json({
      timezone: await getAppTimezone(),
      defaultTimezone: DEFAULT_TIMEZONE,
      // A snapshot of what this Node build recognises, for the UI picker.
      timezones: Intl.supportedValuesOf('timeZone'),
      // What the operator has set (may be ''); `dashboardUrlEffective` is what
      // the invite links (plan.md §158) will actually use — the stored value
      // or a `dashboard.<domain>` guess, or null if neither is available.
      dashboardUrl: await getStoredDashboardUrl(),
      dashboardUrlEffective: await getDashboardBaseUrl(),
      // Which branch the self-update panel (Update page) fetches/pulls —
      // plan.md §406. `main` unless this deployment tracks something else
      // (e.g. `beta` on a test box that stages ahead of production).
      updateBranch: await getUpdateBranch(),
      defaultUpdateBranch: DEFAULT_UPDATE_BRANCH,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load general settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/general — update general dashboard settings
// Applies to every managed app that reads ${TZ} and hasn't pinned its own in
// that app's .env; takes effect the next time each app is started/restarted.
// ---------------------------------------------------------------------------
router.put('/general', async (req: Request, res: Response) => {
  const timezone = req.body?.timezone;
  if (!isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'Unknown timezone. Use an IANA name like "Europe/Lisbon".' });
  }

  // Optional; '' clears it (back to the derived guess). Anything else must be
  // a bare absolute http(s) origin.
  const dashboardUrl = req.body?.dashboardUrl;
  const hasDashboardUrl = dashboardUrl !== undefined && dashboardUrl !== null;
  if (hasDashboardUrl && dashboardUrl !== '' && !isValidDashboardUrl(dashboardUrl)) {
    return res.status(400).json({ error: 'Dashboard URL must be a full https:// address with no path.' });
  }

  // Optional; '' (or omitted) resets to the default (main). Anything else
  // must look like a real branch name — it's interpolated into a git argv.
  const updateBranch = req.body?.updateBranch;
  const hasUpdateBranch = updateBranch !== undefined && updateBranch !== null;
  if (hasUpdateBranch && updateBranch !== '' && !isValidBranchName(updateBranch)) {
    return res.status(400).json({ error: 'Update branch must be a plain git branch name.' });
  }

  try {
    await setAppTimezone(timezone);
    if (hasDashboardUrl) {
      await setDashboardUrl(dashboardUrl);
    }
    if (hasUpdateBranch) {
      await setUpdateBranch(updateBranch || DEFAULT_UPDATE_BRANCH);
    }
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: [
        'app_timezone',
        hasDashboardUrl && 'dashboard_url',
        hasUpdateBranch && 'update_branch',
      ]
        .filter(Boolean)
        .join(', '),
      result: 'success',
    });

    return res.json({
      timezone,
      ...(hasDashboardUrl ? { dashboardUrl: await getStoredDashboardUrl() } : {}),
      ...(hasUpdateBranch ? { updateBranch: await getUpdateBranch() } : {}),
      message: 'Settings saved. Restart apps to apply the timezone.',
    });
  } catch {
    return res.status(500).json({ error: 'Unable to save general settings.' });
  }
});

export default router;
