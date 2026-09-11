import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComposeFile } from '../config/services';
import { applyNpmMarkedBlock } from './npmConfigWriter';
import { applyNpmSecurityHeaders, __test } from './npmSecurityHeaders';

const { buildHstsBlock, HSTS_MARKER_BEGIN, HSTS_MARKER_END } = __test;

vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('./npmConfigWriter', () => ({
  NPM_SERVICE: 'nginx-proxy-manager',
  applyNpmMarkedBlock: vi.fn(),
}));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedApply = vi.mocked(applyNpmMarkedBlock);

describe('buildHstsBlock (§402)', () => {
  const block = buildHstsBlock();

  it('sets max-age to at least 15552000s, the floor Nextcloud\'s own check accepts', () => {
    expect(block).toContain('max-age=15552000');
  });

  it('applies unconditionally ("always"), not gated on a forwarded-proto check', () => {
    expect(block).toContain('Strict-Transport-Security');
    expect(block).toContain('always;');
    expect(block).not.toContain('X-Forwarded-Proto');
  });

  it('is fenced by the module\'s own markers', () => {
    expect(block.startsWith(HSTS_MARKER_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(HSTS_MARKER_END)).toBe(true);
  });
});

describe('applyNpmSecurityHeaders (§402)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing for any other service', async () => {
    await applyNpmSecurityHeaders('nextcloud');
    expect(mockedResolve).not.toHaveBeenCalled();
    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('does nothing when NPM is not part of this deployment', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'nginx-proxy-manager',
      appDir: '/apps/nginx-proxy-manager',
      composeFile: null,
      composeArgs: '',
    } as ReturnType<typeof resolveComposeFile>);

    await applyNpmSecurityHeaders('nginx-proxy-manager');

    expect(mockedApply).not.toHaveBeenCalled();
  });

  it('writes the HSTS block into server_proxy.conf, fenced by its own markers', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'nginx-proxy-manager',
      appDir: '/apps/nginx-proxy-manager',
      composeFile: '/apps/nginx-proxy-manager/compose.yaml',
      composeArgs: '-f /apps/nginx-proxy-manager/compose.yaml',
    } as ReturnType<typeof resolveComposeFile>);

    await applyNpmSecurityHeaders('nginx-proxy-manager');

    expect(mockedApply).toHaveBeenCalledTimes(1);
    const call = mockedApply.mock.calls[0][0];
    expect(call.target).toBe('/apps/nginx-proxy-manager/data/app/nginx/custom/server_proxy.conf');
    expect(call.begin).toBe(HSTS_MARKER_BEGIN);
    expect(call.end).toBe(HSTS_MARKER_END);
    expect(call.block).toBe(buildHstsBlock());
  });
});
