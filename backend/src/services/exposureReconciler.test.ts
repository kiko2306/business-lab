import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAuditLog: vi.fn(async () => {}) }));
const exposureSettings = vi.hoisted(() => ({ getExposureConfig: vi.fn() }));
const exposure = vi.hoisted(() => ({
  provisionServiceIfEnabled: vi.fn(),
  getServiceExposureRow: vi.fn(),
}));
const homepage = vi.hoisted(() => ({ regenerateHomepageServices: vi.fn(async () => {}) }));
const registry = vi.hoisted(() => ({ SERVICES: {} as Record<string, unknown> }));

vi.mock('../utils/database', () => db);
vi.mock('../utils/audit', () => audit);
vi.mock('../utils/exposureSettings', () => exposureSettings);
vi.mock('./exposure', () => exposure);
vi.mock('./homepageConfig', () => homepage);
vi.mock('../config/services', () => registry);
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { reconcileExposureDrift as reconcile, EXPOSURE_RECONCILE_LAST_RUN_KEY } from './exposureReconciler';

/** Rows the `SELECT ... FROM service_exposure` returns. */
const exposedRows = (...names: string[]) => ({ rows: names.map((service_name) => ({ service_name })) });

/**
 * Run a reconcile pass, pumping fake timers so the 2s between-services pause
 * doesn't make the test wait for real.
 */
async function reconcileExposureDrift(): ReturnType<typeof reconcile> {
  const pending = reconcile();
  await vi.runAllTimersAsync();
  return pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  registry.SERVICES = { npm: {}, nextcloud: {}, vaultwarden: {}, jellyfin: {} };
  exposureSettings.getExposureConfig.mockResolvedValue({ baseDomain: 'example.com' });
  exposure.provisionServiceIfEnabled.mockResolvedValue({ attempted: true, success: true });
  exposure.getServiceExposureRow.mockResolvedValue({ status: 'provisioned', last_error: null });
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM service_exposure')) return exposedRows('nextcloud', 'vaultwarden');
    return { rows: [] };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reconcileExposureDrift', () => {
  it('bails when the service registry is empty', async () => {
    registry.SERVICES = {};
    expect(await reconcileExposureDrift()).toBeNull();
    expect(exposure.provisionServiceIfEnabled).not.toHaveBeenCalled();
  });

  it('bails when global exposure config is not set', async () => {
    exposureSettings.getExposureConfig.mockResolvedValue(null);
    expect(await reconcileExposureDrift()).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('re-asserts every enabled primary exposure and reports a clean pass', async () => {
    const summary = await reconcileExposureDrift();

    expect(exposure.provisionServiceIfEnabled.mock.calls.map((c) => c[0])).toEqual(['nextcloud', 'vaultwarden']);
    // userId 0 — the "system" sentinel.
    expect(exposure.provisionServiceIfEnabled).toHaveBeenCalledWith('nextcloud', 0);
    expect(summary).toEqual({ checked: 2, reconciled: 2, failed: [] });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
    expect(homepage.regenerateHomepageServices).toHaveBeenCalledOnce();
  });

  it('records the heartbeat setting after a pass', async () => {
    await reconcileExposureDrift();
    const write = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO settings'));
    expect(write).toBeDefined();
    expect(write![1][0]).toBe(EXPOSURE_RECONCILE_LAST_RUN_KEY);
  });

  it('skips secondary rows and names the registry does not know', async () => {
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM service_exposure')) {
        return exposedRows('nextcloud', 'ghost-app');
      }
      return { rows: [] };
    });
    // The SQL already filters `service_name NOT LIKE '%:%'`, so secondary keys
    // never reach here; `ghost-app` is filtered in code because SERVICES lacks it.
    const summary = await reconcileExposureDrift();
    expect(exposure.provisionServiceIfEnabled.mock.calls.map((c) => c[0])).toEqual(['nextcloud']);
    expect(summary?.checked).toBe(1);
  });

  it('flags a service whose exposure will not come back, with an audit row', async () => {
    exposure.getServiceExposureRow.mockImplementation(async (name: string) =>
      name === 'vaultwarden'
        ? { status: 'failed', last_error: 'NPM host 7 not found' }
        : { status: 'provisioned', last_error: null }
    );

    const summary = await reconcileExposureDrift();

    expect(summary).toEqual({
      checked: 2,
      reconciled: 1,
      failed: [{ service: 'vaultwarden', error: 'NPM host 7 not found' }],
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exposure_reconcile', result: 'failure' })
    );
  });

  it('treats a thrown provisioning error as a failure, not a crash', async () => {
    exposure.provisionServiceIfEnabled.mockImplementation(async (name: string) => {
      if (name === 'nextcloud') throw new Error('cloudflare 403');
      return { attempted: true, success: true };
    });

    const summary = await reconcileExposureDrift();

    expect(summary?.failed).toEqual([{ service: 'nextcloud', error: 'cloudflare 403' }]);
    expect(summary?.reconciled).toBe(1);
  });
});
