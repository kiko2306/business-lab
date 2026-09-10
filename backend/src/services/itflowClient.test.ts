import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetupState, runSetupWizard } from './itflowClient';

const BASE = 'http://itflow.test';
const realFetch = globalThis.fetch;

function res(init: { status?: number; type?: string; body?: string }): Response {
  return {
    status: init.status ?? 200,
    type: init.type ?? 'basic',
    text: async () => init.body ?? '',
  } as Response;
}

// The "database step is done" page GET setup/?database returns once config.php
// exists; before that it re-renders the add_database form.
const DB_DONE_BODY = '<p>Database is already configured. Any further changes...</p>';
const DB_FORM_BODY = '<form><button name="add_database">Next</button></form>';

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('getSetupState', () => {
  it('is needs-setup on a 200', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ status: 200 }));
    expect(await getSetupState(BASE)).toBe('needs-setup');
  });

  it('is already-setup on an opaque redirect (setup/ -> /login.php)', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ status: 0, type: 'opaqueredirect' }));
    expect(await getSetupState(BASE)).toBe('already-setup');
  });

  it('is unreachable on a network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await getSetupState(BASE)).toBe('unreachable');
  });

  it('is unreachable on a 5xx', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ status: 502 }));
    expect(await getSetupState(BASE)).toBe('unreachable');
  });
});

describe('runSetupWizard', () => {
  const input = {
    name: 'Mig',
    email: 'm@e.com',
    password: 'pw',
    companyName: 'Co',
    timezone: 'UTC',
    dbHost: 'itflow-db',
    dbName: 'itflow',
    dbUser: 'itflow',
    dbPassword: 'dbsecret',
  };

  it('POSTs add_database first, then the four steps, and returns completed', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // add_database
      .mockResolvedValueOnce(res({ status: 200, body: DB_DONE_BODY })) // GET ?database confirm
      .mockResolvedValueOnce(res({ status: 302 })) // add_user
      .mockResolvedValueOnce(res({ status: 302 })) // add_company_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_localization_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_telemetry
      .mockResolvedValueOnce(res({ status: 0, type: 'opaqueredirect' })); // getSetupState -> already-setup

    expect(await runSetupWizard(BASE, input)).toBe('completed');

    const bodies = f.mock.calls
      .map(([, opts]) => (opts as RequestInit | undefined)?.body as string | undefined)
      .filter((b): b is string => typeof b === 'string');
    expect(bodies[0]).toContain('add_database=1');
    expect(bodies[0]).toContain('host=itflow-db');
    expect(bodies[0]).toContain('database=itflow');
    expect(bodies[0]).toContain('username=itflow');
    expect(bodies[0]).toContain('password=dbsecret');
    expect(bodies[1]).toContain('add_user=1');
    expect(bodies[1]).toContain('email=m%40e.com');
    expect(bodies[2]).toContain('add_company_settings=1');
    expect(bodies[3]).toContain('add_localization_settings=1');
    expect(bodies[4]).toContain('add_telemetry=1');
    // no share_data — no phone-home
    expect(bodies[4]).not.toContain('share_data');
  });

  it('returns failed when add_database does not redirect (connection test failed)', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ status: 200, body: 'Database connection failed' }));
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });

  it('returns failed when the ?database confirm still shows the add_database form', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // add_database redirected...
      .mockResolvedValueOnce(res({ status: 200, body: DB_FORM_BODY })); // ...but config.php not written
    expect(await runSetupWizard(BASE, input)).toBe('failed');
    expect(f).toHaveBeenCalledTimes(2); // stops before add_user
  });

  it('returns failed when the final POST does not redirect', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // add_database
      .mockResolvedValueOnce(res({ status: 200, body: DB_DONE_BODY })) // ?database confirm
      .mockResolvedValueOnce(res({ status: 302 })) // add_user
      .mockResolvedValueOnce(res({ status: 302 })) // add_company_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_localization_settings
      .mockResolvedValueOnce(res({ status: 200 })); // add_telemetry - no redirect
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });

  it('returns failed on a thrown request', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('boom'));
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });
});
