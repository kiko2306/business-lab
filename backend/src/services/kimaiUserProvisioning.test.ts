import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runKimaiDbScript } from './kimaiDb';
import { disableKimaiUser, provisionKimaiUser } from './kimaiUserProvisioning';

vi.mock('./kimaiDb', () => ({ runKimaiDbScript: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedRun = vi.mocked(runKimaiDbScript);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('provisionKimaiUser', () => {
  const input = { email: 'bob@example.com', password: 'pw', displayName: 'Bob Jones' };

  it('reports a fresh account as created', async () => {
    mockedRun.mockResolvedValue({ ok: true, output: 'CREATED' });
    await expect(provisionKimaiUser(input)).resolves.toBe('created');
  });

  it('reports an existing account as updated (password refreshed)', async () => {
    mockedRun.mockResolvedValue({ ok: true, output: 'UPDATED' });
    await expect(provisionKimaiUser(input)).resolves.toBe('updated');
  });

  it('fails when the script itself fails', async () => {
    mockedRun.mockResolvedValue({ ok: false, output: 'SQLSTATE[HY000] [2002] Connection refused' });
    await expect(provisionKimaiUser(input)).resolves.toBe('failed');
  });

  it('passes the email, password and display name through as env, not script text', async () => {
    mockedRun.mockResolvedValue({ ok: true, output: 'CREATED' });
    await provisionKimaiUser(input);
    const [script, opts] = mockedRun.mock.calls[0];
    expect(script.join('\n')).not.toContain('bob@example.com');
    expect(script.join('\n')).not.toContain('Bob Jones');
    expect(opts?.env?.KIMAI_FANOUT_EMAIL).toBe('bob@example.com');
    expect(opts?.env?.KIMAI_FANOUT_PASSWORD).toBe('pw');
    expect(opts?.env?.KIMAI_FANOUT_DISPLAY_NAME).toBe('Bob Jones');
    expect(opts?.passEnv).toEqual(['KIMAI_FANOUT_EMAIL', 'KIMAI_FANOUT_PASSWORD', 'KIMAI_FANOUT_DISPLAY_NAME']);
  });
});

describe('disableKimaiUser', () => {
  it('reports disabled when the account exists', async () => {
    mockedRun.mockResolvedValue({ ok: true, output: 'DISABLED' });
    await expect(disableKimaiUser('bob@example.com')).resolves.toBe('disabled');
  });

  it('reports not-found when no account has that email', async () => {
    mockedRun.mockResolvedValue({ ok: true, output: 'NOT_FOUND' });
    await expect(disableKimaiUser('bob@example.com')).resolves.toBe('not-found');
  });

  it('fails when the script itself fails', async () => {
    mockedRun.mockResolvedValue({ ok: false, output: 'boom' });
    await expect(disableKimaiUser('bob@example.com')).resolves.toBe('failed');
  });
});
