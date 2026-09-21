import { beforeEach, describe, expect, it, vi } from 'vitest';

const itflowDb = vi.hoisted(() => ({ runItflowDbScript: vi.fn() }));
const appEnv = vi.hoisted(() => ({ readAppEnvValue: vi.fn() }));
const registry = vi.hoisted(() => ({ resolveComposeFile: vi.fn() }));

vi.mock('./itflowDb', () => itflowDb);
vi.mock('./appEnv', () => appEnv);
vi.mock('../config/services', () => registry);
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { reconcileItflowBillingModule, buildBillingModuleScript } from './itflowBillingModule';

describe('buildBillingModuleScript', () => {
  it('writes 0 to hide the module', () => {
    const script = buildBillingModuleScript(true).join('\n');
    expect(script).toContain('UPDATE settings SET config_module_enable_accounting = 0 WHERE company_id = 1');
  });

  it('writes 1 to restore the module', () => {
    const script = buildBillingModuleScript(false).join('\n');
    expect(script).toContain('UPDATE settings SET config_module_enable_accounting = 1 WHERE company_id = 1');
  });
});

describe('reconcileItflowBillingModule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.resolveComposeFile.mockReturnValue({ composeFile: '/apps/itflow/docker-compose.yml' });
    itflowDb.runItflowDbScript.mockResolvedValue({ ok: true, output: '' });
  });

  const scriptOf = () => itflowDb.runItflowDbScript.mock.calls[0][0].join('\n') as string;

  it('is a no-op for a non-itflow service', async () => {
    await reconcileItflowBillingModule('nextcloud');
    expect(itflowDb.runItflowDbScript).not.toHaveBeenCalled();
  });

  it('is a no-op when itflow is not installed', async () => {
    registry.resolveComposeFile.mockReturnValue(undefined);
    await reconcileItflowBillingModule('itflow');
    expect(itflowDb.runItflowDbScript).not.toHaveBeenCalled();
  });

  it('hides the module when the toggle is true', async () => {
    appEnv.readAppEnvValue.mockReturnValue('true');
    await reconcileItflowBillingModule('itflow');
    expect(scriptOf()).toContain('config_module_enable_accounting = 0');
  });

  it('restores the module when the toggle is false', async () => {
    appEnv.readAppEnvValue.mockReturnValue('false');
    await reconcileItflowBillingModule('itflow');
    expect(scriptOf()).toContain('config_module_enable_accounting = 1');
  });

  it('restores the module when the toggle is unset', async () => {
    appEnv.readAppEnvValue.mockReturnValue(null);
    await reconcileItflowBillingModule('itflow');
    expect(scriptOf()).toContain('config_module_enable_accounting = 1');
  });

  it('is case-insensitive and trims whitespace on the toggle value', async () => {
    appEnv.readAppEnvValue.mockReturnValue(' TRUE ');
    await reconcileItflowBillingModule('itflow');
    expect(scriptOf()).toContain('config_module_enable_accounting = 0');
  });

  it('never throws even if runItflowDbScript rejects', async () => {
    appEnv.readAppEnvValue.mockReturnValue('true');
    itflowDb.runItflowDbScript.mockRejectedValue(new Error('boom'));
    await expect(reconcileItflowBillingModule('itflow')).resolves.toBeUndefined();
  });
});
