import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetupState, runSetupWizard } from './itflowClient';

const BASE = 'http://itflow.test';
const realFetch = globalThis.fetch;

function res(init: { status?: number; type?: string; text?: string }): Response {
  return {
    status: init.status ?? 200,
    type: init.type ?? 'basic',
    text: async () => init.text ?? '',
  } as Response;
}

const USER_PAGE_WITH_FORM = '<form method="post"><input name="name"><button name="add_user">Next</button></form>';
const USER_PAGE_CONTINUE = '<a href="?checks">Continue Setup</a>';

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('getSetupState', () => {
  it('is needs-setup when /setup/ is 200 and ?user shows the add_user form', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res({ status: 200 })) // GET /setup/
      .mockResolvedValueOnce(res({ status: 200, text: USER_PAGE_WITH_FORM })); // GET /setup/?user
    expect(await getSetupState(BASE)).toBe('needs-setup');
  });

  it('is not-ready when ?user does NOT show the form yet (schema still migrating)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res({ status: 200 }))
      .mockResolvedValueOnce(res({ status: 200, text: USER_PAGE_CONTINUE }));
    expect(await getSetupState(BASE)).toBe('not-ready');
  });

  it('is already-setup when /setup/ redirects', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(res({ status: 0, type: 'opaqueredirect' }));
    expect(await getSetupState(BASE)).toBe('already-setup');
  });

  it('is unreachable on a network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await getSetupState(BASE)).toBe('unreachable');
  });

  it('is unreachable when ?user is not 200', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(res({ status: 200 }))
      .mockResolvedValueOnce(res({ status: 502 }));
    expect(await getSetupState(BASE)).toBe('unreachable');
  });
});

describe('runSetupWizard', () => {
  const input = { name: 'Mig', email: 'm@e.com', password: 'pw', companyName: 'Co', timezone: 'UTC' };

  it('bails without POSTing telemetry when the user was not created', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // POST add_user
      .mockResolvedValueOnce(res({ status: 200, text: USER_PAGE_WITH_FORM })); // verify: form still there
    expect(await runSetupWizard(BASE, input)).toBe('failed');
    const bodies = f.mock.calls.map(([, o]) => (o as RequestInit).body as string).filter(Boolean);
    expect(bodies.some((b) => b.includes('add_telemetry'))).toBe(false);
    expect(bodies.some((b) => b.includes('add_company_settings'))).toBe(false);
  });

  it('runs all four steps and returns completed when /setup/ finally redirects', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // POST add_user
      .mockResolvedValueOnce(res({ status: 200, text: USER_PAGE_CONTINUE })) // verify: form gone
      .mockResolvedValueOnce(res({ status: 302 })) // add_company_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_localization_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_telemetry
      .mockResolvedValueOnce(res({ status: 0, type: 'opaqueredirect' })); // final GET /setup/

    expect(await runSetupWizard(BASE, input)).toBe('completed');
    const bodies = f.mock.calls.map(([, o]) => (o as RequestInit).body as string).filter(Boolean);
    expect(bodies[0]).toContain('add_user=1');
    expect(bodies[1]).toContain('add_company_settings=1');
    expect(bodies[2]).toContain('add_localization_settings=1');
    expect(bodies[3]).toContain('add_telemetry=1');
    expect(bodies[3]).not.toContain('share_data');
  });

  it('returns failed when the final /setup/ check does not redirect', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 }))
      .mockResolvedValueOnce(res({ status: 200, text: USER_PAGE_CONTINUE }))
      .mockResolvedValueOnce(res({ status: 302 }))
      .mockResolvedValueOnce(res({ status: 302 }))
      .mockResolvedValueOnce(res({ status: 302 }))
      .mockResolvedValueOnce(res({ status: 200 })); // /setup/ still 200 — not done
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });
});
