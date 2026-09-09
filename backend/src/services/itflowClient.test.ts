import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSetupState, runSetupWizard } from './itflowClient';

const BASE = 'http://itflow.test';
const realFetch = globalThis.fetch;

function res(init: { status?: number; type?: string }): Response {
  return { status: init.status ?? 200, type: init.type ?? 'basic' } as Response;
}

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
  const input = { name: 'Mig', email: 'm@e.com', password: 'pw', companyName: 'Co', timezone: 'UTC' };

  it('POSTs the four steps in order and returns completed when telemetry redirects', async () => {
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(res({ status: 302 })) // add_user
      .mockResolvedValueOnce(res({ status: 302 })) // add_company_settings
      .mockResolvedValueOnce(res({ status: 302 })) // add_localization_settings
      .mockResolvedValueOnce(res({ status: 0, type: 'opaqueredirect' })); // add_telemetry

    expect(await runSetupWizard(BASE, input)).toBe('completed');

    const bodies = f.mock.calls.map(([, opts]) => (opts as RequestInit).body as string);
    expect(bodies[0]).toContain('add_user=1');
    expect(bodies[0]).toContain('email=m%40e.com');
    expect(bodies[1]).toContain('add_company_settings=1');
    expect(bodies[2]).toContain('add_localization_settings=1');
    expect(bodies[3]).toContain('add_telemetry=1');
    // no share_data — no phone-home
    expect(bodies[3]).not.toContain('share_data');
  });

  it('returns failed when the final POST does not redirect', async () => {
    vi.mocked(fetch).mockResolvedValue(res({ status: 200 }));
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });

  it('returns failed on a thrown request', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('boom'));
    expect(await runSetupWizard(BASE, input)).toBe('failed');
  });
});
