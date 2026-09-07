import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn().mockReturnValue(10230),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn().mockResolvedValue('10.201.0.1') }));

const { readAppEnvValue } = vi.hoisted(() => ({ readAppEnvValue: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue }));

const { getClaudeApiKey } = vi.hoisted(() => ({ getClaudeApiKey: vi.fn() }));
vi.mock('../utils/claudeSettings', () => ({ getClaudeApiKey }));

const client = vi.hoisted(() => ({
  mealieLogin: vi.fn(),
  mealieChangePassword: vi.fn(),
  mealieGetAiSettings: vi.fn(),
  mealieCreateAiProvider: vi.fn(),
  mealieUpdateAiProvider: vi.fn(),
  mealieDeleteAiProvider: vi.fn(),
  mealieSetAiSettings: vi.fn(),
}));
vi.mock('./mealieClient', () => client);

import { resolveComposeFile } from '../config/services';
import { syncMealieAiProvider } from './mealieAiSync';

const installed = () =>
  ({
    projectName: 'mealie',
    appDir: '/apps/mealie',
    composeFile: '/apps/mealie/docker-compose.yml',
    composeArgs: '-f /apps/mealie/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveComposeFile).mockReturnValue(installed());
  readAppEnvValue.mockReturnValue('generated-admin-pw');
  client.mealieLogin.mockResolvedValue('tok'); // generated password works
  client.mealieGetAiSettings.mockResolvedValue({ defaultProviderId: null, providers: [] });
  client.mealieCreateAiProvider.mockResolvedValue('new-id');
});

describe('syncMealieAiProvider', () => {
  it('does nothing for a service other than mealie', async () => {
    await syncMealieAiProvider('guacamole');
    expect(client.mealieLogin).not.toHaveBeenCalled();
  });

  it('does nothing when Mealie is not installed', async () => {
    vi.mocked(resolveComposeFile).mockReturnValue(undefined as unknown as ReturnType<typeof resolveComposeFile>);
    await syncMealieAiProvider('mealie');
    expect(client.mealieLogin).not.toHaveBeenCalled();
  });

  it('creates the managed provider and sets it as default when a key is stored', async () => {
    getClaudeApiKey.mockResolvedValue('sk-ant-abc123');
    await syncMealieAiProvider('mealie');

    expect(client.mealieCreateAiProvider).toHaveBeenCalledWith(
      'http://10.201.0.1:10230',
      'tok',
      expect.objectContaining({
        base_url: 'https://api.anthropic.com/v1/',
        api_key: 'sk-ant-abc123',
        model: 'claude-haiku-4-5',
      })
    );
    expect(client.mealieSetAiSettings).toHaveBeenCalledWith('http://10.201.0.1:10230', 'tok', 'new-id');
  });

  it('updates the existing managed provider and skips the settings write when it is already default', async () => {
    getClaudeApiKey.mockResolvedValue('sk-ant-abc123');
    client.mealieGetAiSettings.mockResolvedValue({
      defaultProviderId: 'p1',
      providers: [{ id: 'p1', name: 'Claude (dashboard-managed)' }],
    });

    await syncMealieAiProvider('mealie');

    expect(client.mealieUpdateAiProvider).toHaveBeenCalledWith(
      'http://10.201.0.1:10230',
      'tok',
      'p1',
      expect.objectContaining({ api_key: 'sk-ant-abc123' })
    );
    expect(client.mealieCreateAiProvider).not.toHaveBeenCalled();
    expect(client.mealieSetAiSettings).not.toHaveBeenCalled();
  });

  it('disables AI and removes the managed provider when the key is gone', async () => {
    getClaudeApiKey.mockResolvedValue(null);
    client.mealieGetAiSettings.mockResolvedValue({
      defaultProviderId: 'p1',
      providers: [{ id: 'p1', name: 'Claude (dashboard-managed)' }],
    });

    await syncMealieAiProvider('mealie');

    expect(client.mealieSetAiSettings).toHaveBeenCalledWith('http://10.201.0.1:10230', 'tok', null);
    expect(client.mealieDeleteAiProvider).toHaveBeenCalledWith('http://10.201.0.1:10230', 'tok', 'p1');
  });

  it('rotates the shipped default password when the generated one is not accepted yet', async () => {
    getClaudeApiKey.mockResolvedValue('sk-ant-abc123');
    // generated pw rejected, shipped default accepted, then generated works after the change
    client.mealieLogin
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('default-tok')
      .mockResolvedValueOnce('tok');
    client.mealieChangePassword.mockResolvedValue(true);

    await syncMealieAiProvider('mealie');

    expect(client.mealieChangePassword).toHaveBeenCalledWith(
      'http://10.201.0.1:10230',
      'default-tok',
      'MyPassword',
      'generated-admin-pw'
    );
    expect(client.mealieCreateAiProvider).toHaveBeenCalled();
  });
});
