import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { archiveDocusealUser, reconcileDocusealAdminPassword, setDocusealUserPassword } from './docusealDb';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'docuseal',
    appDir: '/apps/docuseal',
    composeFile: '/apps/docuseal/docker-compose.yml',
    composeArgs: '-f /apps/docuseal/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
});

describe('setDocusealUserPassword', () => {
  it('is not installed → fails without touching docker', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'docuseal',
      appDir: '/apps/docuseal',
      composeFile: null,
      composeArgs: '',
    } as ReturnType<typeof resolveComposeFile>);
    const result = await setDocusealUserPassword('a@example.com', 'pw');
    expect(result).toBe('failed');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs rails runner in a one-off container, passing the secret via -e only', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'updated\n', '');
    }) as unknown as typeof exec);
    const result = await setDocusealUserPassword('a@example.com', 'hunter2');
    expect(result).toBe('updated');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p docuseal');
    expect(command).toContain('run --rm --no-deps -T');
    expect(command).toContain('--entrypoint /bin/sh docuseal');
    expect(command).toContain('/app/bin/rails runner -');
    expect(command).toContain('-e DOCUSEAL_FANOUT_EMAIL -e DOCUSEAL_FANOUT_PASSWORD');
    expect(command).not.toContain('hunter2');
    const env = mockedExec.mock.calls[0][1] as { env?: Record<string, string> };
    expect(env.env?.DOCUSEAL_FANOUT_PASSWORD).toBe('hunter2');
  });

  it('reports a user with no DocuSeal account as not-found', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'not-found\n', '');
    }) as unknown as typeof exec);
    const result = await setDocusealUserPassword('nobody@example.com', 'pw');
    expect(result).toBe('not-found');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'no such service: docuseal');
    }) as unknown as typeof exec);
    const result = await setDocusealUserPassword('a@example.com', 'pw');
    expect(result).toBe('failed');
  });
});

describe('archiveDocusealUser', () => {
  it('is not installed → fails without touching docker', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'docuseal',
      appDir: '/apps/docuseal',
      composeFile: null,
      composeArgs: '',
    } as ReturnType<typeof resolveComposeFile>);
    const result = await archiveDocusealUser('a@example.com');
    expect(result).toBe('failed');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('archives the user, passing only the email via -e', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'archived\n', '');
    }) as unknown as typeof exec);
    const result = await archiveDocusealUser('a@example.com');
    expect(result).toBe('archived');
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('-e DOCUSEAL_FANOUT_EMAIL');
    expect(command).not.toContain('DOCUSEAL_FANOUT_PASSWORD');
  });

  it('reports a missing account as not-found', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'not-found\n', '');
    }) as unknown as typeof exec);
    const result = await archiveDocusealUser('nobody@example.com');
    expect(result).toBe('not-found');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'no such service: docuseal');
    }) as unknown as typeof exec);
    const result = await archiveDocusealUser('a@example.com');
    expect(result).toBe('failed');
  });
});

describe('reconcileDocusealAdminPassword', () => {
  it('is not installed → fails without touching docker', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'docuseal',
      appDir: '/apps/docuseal',
      composeFile: null,
      composeArgs: '',
    } as ReturnType<typeof resolveComposeFile>);
    const result = await reconcileDocusealAdminPassword('a@example.com', 'pw');
    expect(result).toBe('failed');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('checks valid_password? first and reports unchanged without writing anything', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'unchanged\n', '');
    }) as unknown as typeof exec);
    const result = await reconcileDocusealAdminPassword('a@example.com', 'hunter2');
    expect(result).toBe('unchanged');
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('-e DOCUSEAL_FANOUT_EMAIL -e DOCUSEAL_FANOUT_PASSWORD');
    expect(command).not.toContain('hunter2');
  });

  it('reports synced when the password actually needed updating', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'synced\n', '');
    }) as unknown as typeof exec);
    const result = await reconcileDocusealAdminPassword('a@example.com', 'new-pw');
    expect(result).toBe('synced');
  });

  it('reports a missing account as not-found', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(null, 'not-found\n', '');
    }) as unknown as typeof exec);
    const result = await reconcileDocusealAdminPassword('nobody@example.com', 'pw');
    expect(result).toBe('not-found');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'no such service: docuseal');
    }) as unknown as typeof exec);
    const result = await reconcileDocusealAdminPassword('a@example.com', 'pw');
    expect(result).toBe('failed');
  });
});
