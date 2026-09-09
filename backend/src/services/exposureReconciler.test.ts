import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
const audit = vi.hoisted(() => ({ writeAuditLog: vi.fn(async () => {}) }));
const exposureSettings = vi.hoisted(() => ({ getExposureConfig: vi.fn() }));
const exposure = vi.hoisted(() => ({
  ensureAutoExposure: vi.fn(),
  provisionServiceIfEnabled: vi.fn(),
  getServiceExposureRow: vi.fn(),
}));
const homepage = vi.hoisted(() => ({ regenerateHomepageServices: vi.fn(async () => {}) }));
const authelia = vi.hoisted(() => ({
  syncAutheliaAccessControlSafe: vi.fn(async () => null),
  syncAutheliaOidcClientsSafe: vi.fn(async () => null),
}));
const registry = vi.hoisted(() => ({ SERVICES: {} as Record<string, unknown> }));

vi.mock('../utils/database', () => db);
vi.mock('../utils/audit', () => audit);
vi.mock('../utils/exposureSettings', () => exposureSettings);
vi.mock('./exposure', () => exposure);
vi.mock('./homepageConfig', () => homepage);
vi.mock('./autheliaAccessControl', () => ({ syncAutheliaAccessControlSafe: authelia.syncAutheliaAccessControlSafe }));
vi.mock('./autheliaOidcClients', () => ({ syncAutheliaOidcClientsSafe: authelia.syncAutheliaOidcClientsSafe }));
vi.mock('../config/services', () => registry);
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { reconcileExposureDrift as reconcile, EXPOSURE_RECONCILE_LAST_RUN_KEY } from './exposureReconciler';

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
  // Two exposable (nextcloud, vaultwarden), one not (samba), plus a secondary key.
  registry.SERVICES = { nextcloud: {}, vaultwarden: {}, samba: {}, 'nextcloud:api': {} };
  exposureSettings.getExposureConfig.mockResolvedValue({ baseDomain: 'example.com' });
  exposure.ensureAutoExposure.mockResolvedValue(undefined);
  // Not-exposable services report attempted:false from provisionServiceIfEnabled
  // (their row never gets enabled) — the reconciler skips them in its tally.
  exposure.provisionServiceIfEnabled.mockImplementation(async (name: string) =>
    name === 'samba' ? { attempted: false } : { attempted: true, success: true }
  );
  exposure.getServiceExposureRow.mockResolvedValue({ status: 'provisioned', last_error: null });
  db.query.mockResolvedValue({ rows: [] });
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
    expect(exposure.provisionServiceIfEnabled).not.toHaveBeenCalled();
  });

  it('sweeps every primary registry service and reports a clean pass', async () => {
    const summary = await reconcileExposureDrift();

    // Every primary (secondary `nextcloud:api` filtered out); ensureAutoExposure
    // first so an exposable app that has no row yet gets one.
    expect(exposure.ensureAutoExposure.mock.calls.map((c) => c[0])).toEqual(['nextcloud', 'vaultwarden', 'samba']);
    expect(exposure.provisionServiceIfEnabled.mock.calls.map((c) => c[0])).toEqual([
      'nextcloud',
      'vaultwarden',
      'samba',
    ]);
    // userId 0 — the "system" sentinel.
    expect(exposure.provisionServiceIfEnabled).toHaveBeenCalledWith('nextcloud', 0);
    // samba is not exposable (attempted:false) — not counted.
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

  it('never touches secondary keys directly', async () => {
    await reconcileExposureDrift();
    expect(exposure.ensureAutoExposure.mock.calls.map((c) => c[0])).not.toContain('nextcloud:api');
    expect(exposure.provisionServiceIfEnabled.mock.calls.map((c) => c[0])).not.toContain('nextcloud:api');
  });

  it('re-asserts the Authelia rules + OIDC clients every pass (drift backstop)', async () => {
    await reconcileExposureDrift();
    expect(authelia.syncAutheliaAccessControlSafe).toHaveBeenCalledOnce();
    expect(authelia.syncAutheliaOidcClientsSafe).toHaveBeenCalledOnce();
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
      if (name === 'samba') return { attempted: false };
      return { attempted: true, success: true };
    });

    const summary = await reconcileExposureDrift();

    expect(summary?.failed).toEqual([{ service: 'nextcloud', error: 'cloudflare 403' }]);
    // nextcloud threw (counted), vaultwarden ok, samba skipped → checked 2.
    expect(summary?.checked).toBe(2);
    expect(summary?.reconciled).toBe(1);
  });
});
