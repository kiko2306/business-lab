import { test, expect } from '@playwright/test';
import { expandPanel } from './helpers';

/**
 * The flows that need a real Docker socket, a real backup destination and
 * real exposure state — the ones `docker-compose.test.yml`'s socket-less
 * backend cannot exercise (plan.md §131.5, §171).
 *
 * Opt-in and local-only, the same shape as `scripts/smoke-tests.sh`: they run
 * only when `E2E_LIVE_STACK=1` and `E2E_BASE_URL` points at a real dashboard,
 * with `E2E_ADMIN_USER` / `E2E_ADMIN_PASSWORD` set to that dashboard's admin.
 * `scripts/e2e-tests.sh` never sets `E2E_LIVE_STACK`, so CI skips this file.
 *
 *   E2E_LIVE_STACK=1 E2E_BASE_URL=https://dash.example.com \
 *   E2E_ADMIN_USER=admin E2E_ADMIN_PASSWORD=… \
 *   npx playwright test live-stack
 */
const LIVE = process.env.E2E_LIVE_STACK === '1';

// A lightweight, dependency-free app to bounce. Override for a stack that does
// not run Samba. The test leaves it in whatever state it was found in.
const APP = process.env.E2E_LIVE_APP ?? 'samba';

test.describe('live stack — Docker-touching flows', () => {
  test.skip(!LIVE, 'set E2E_LIVE_STACK=1 with E2E_BASE_URL at a live dashboard');

  test(`start / stop ${APP}, restoring its original state`, async ({ page }) => {
    // compose up/down pulls nothing here but still recreates containers.
    test.slow();

    await page.goto('/apps');
    await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible();
    await expandPanel(page, 'All apps');

    // An active search force-expands every category group, so a match is never
    // hidden in a collapsed section.
    await page.getByRole('searchbox', { name: 'Search apps' }).fill(APP);

    const card = page.locator('.service-row').filter({
      has: page.locator('.service-name', { hasText: new RegExp(`^${APP}$`, 'i') }),
    });
    await expect(card, `${APP} is not a managed app on this stack — set E2E_LIVE_APP`).toBeVisible();

    const stateBadge = card.locator('.service-row-heading .badge').first();
    const startBtn = card.getByRole('button', { name: 'Start' });
    const stopBtn = card.getByRole('button', { name: 'Stop' });

    const settle = async (want: 'running' | 'stopped') => {
      // Status is refreshed by polling; a compose action can take a while.
      await expect(stateBadge).toHaveText(want, { timeout: 120_000 });
    };

    const initial = ((await stateBadge.textContent()) ?? '').trim();
    expect(['running', 'stopped'], `unexpected initial state "${initial}"`).toContain(initial);

    const startIt = async () => {
      await startBtn.click();
      // A non-stop action opens a streaming "startup logs" dialog; close it
      // once it is done and fall back to the status badge as the real signal.
      const dialog = page.locator('.startup-logs-dialog');
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: 'Close' }).click({ timeout: 120_000 });
      }
      await settle('running');
    };
    const stopIt = async () => {
      await stopBtn.click();
      await settle('stopped');
    };

    if (initial === 'running') {
      await stopIt();
      await startIt();
    } else {
      await startIt();
      await stopIt();
    }

    // Left as found.
    await expect(stateBadge).toHaveText(initial);
  });

  test('the Backups page renders live schedule and destination', async ({ page }) => {
    await page.goto('/backups');
    await expect(page.getByRole('heading', { name: 'Backups & restore', level: 1 })).toBeVisible();
    await expandPanel(page, 'Backups');

    await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
    // Present whether or not a run has happened; do NOT click it — a real run
    // is long.
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible();
    await expect(page.getByText('Destination:')).toBeVisible();
  });

  test('the Exposure page can test the provisioning connection', async ({ page }) => {
    await page.goto('/exposure');
    await expect(page.getByRole('heading', { name: 'Exposure & networking', level: 1 })).toBeVisible();

    const panel = page.locator('.panel', { has: page.locator('.panel__toggle', { hasText: 'First-start exposure provisioning' }) });
    await expandPanel(page, 'First-start exposure provisioning');
    await expect(panel.getByLabel('Base domain')).toBeVisible();

    const testBtn = panel.getByRole('button', { name: 'Test connection' });
    if (await testBtn.isEnabled()) {
      // A real, non-mutating check of the NPM + Cloudflare reachability the
      // exposure path depends on. Assert the UI surfaces a verdict, not that
      // it passes.
      await testBtn.click();
      await expect(panel.getByText(/Nginx Proxy Manager:/)).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByText(/Cloudflare:/)).toBeVisible();
    } else {
      // Exposure isn't configured on this stack — the button says why.
      await expect(testBtn).toHaveAttribute('title', /Save exposure settings/);
    }
  });
});
