import { describe, expect, it, vi, beforeEach } from 'vitest';
import { exec } from 'child_process';
import { getServiceSetupToken } from './setupToken';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Portainer was the only app that ever declared setupToken, and it has been
// dropped (§81.1a). These tests are about the log parsing — ANSI stripping, the
// pattern — not about any particular app, so the registry is mocked rather than
// the suite being tied to whichever service happens to use the feature next.
vi.mock('../config/services', () => ({
  getService: vi.fn((name: string) =>
    name === 'example' ? { name, setupToken: { logPattern: 'setup_token=(\\S+)' } } : undefined
  ),
  getProjectName: vi.fn((name: string) => name),
}));

const mockedExec = vi.mocked(exec);

function mockExecSequence(outputs: string[]) {
  let call = 0;
  mockedExec.mockImplementation(((_command: string, _options: unknown, callback: (...args: unknown[]) => void) => {
    const output = outputs[call++];
    callback(null, output, '');
  }) as unknown as typeof exec);
}

beforeEach(() => {
  mockedExec.mockReset();
});

describe('getServiceSetupToken', () => {
  it('strips ANSI color codes so they are not swept into the captured token', async () => {
    const rawLine =
      '\x1b[90m2026/08/27 02:06PM\x1b[0m \x1b[32mINF\x1b[0m no administrator account configured' +
      ' | \x1b[36msetup_token=\x1b[0mecfb7281e5565d0df32cf3277de06970247e60bf48d9afb9d9cc7add3fbbcc73\n';

    mockExecSequence(['example-example-1\n', rawLine]);

    const token = await getServiceSetupToken('example');

    expect(token).toBe('ecfb7281e5565d0df32cf3277de06970247e60bf48d9afb9d9cc7add3fbbcc73');
  });

  it('returns the last match when a restart has left an older, stale token in the logs', async () => {
    const logs =
      'no administrator account configured | setup_token=stale000000000000000000000000000000000000000000000000000000000000\n' +
      '... some later restart ...\n' +
      'no administrator account configured | setup_token=fresh111111111111111111111111111111111111111111111111111111111111\n';

    mockExecSequence(['example-example-1\n', logs]);

    const token = await getServiceSetupToken('example');

    expect(token).toBe('fresh111111111111111111111111111111111111111111111111111111111111');
  });

  it('returns null for services without setupToken support', async () => {
    const token = await getServiceSetupToken('nonexistent-service');
    expect(token).toBeNull();
  });
});
