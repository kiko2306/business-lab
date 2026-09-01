import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposure = vi.hoisted(() => ({ getServiceExposureRow: vi.fn() }));
const registry = vi.hoisted(() => ({
  getService: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));

vi.mock('./exposure', () => exposure);
vi.mock('../config/services', () => registry);
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { buildKitchenConfig } from './kitchenConfig';

describe('buildKitchenConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.getService.mockImplementation((name: string) => ({ label: name === 'mealie' ? 'Mealie' : 'Pantry' }));
    registry.getPublishedUpstreamPort.mockImplementation((name: string) => (name === 'mealie' ? 10230 : 10300));
  });

  it('uses the public URL for an app that is exposed and provisioned', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({
      enabled: true,
      status: 'provisioned',
      hostname: 'mealie.example.com',
    });

    const config = await buildKitchenConfig();
    expect(config.mealie.publicUrl).toBe('https://mealie.example.com');
    expect(config.mealie.port).toBe(10230);
  });

  it('leaves publicUrl null when exposure is enabled but not provisioned yet', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({
      enabled: true,
      status: 'failed',
      hostname: 'mealie.example.com',
    });

    const config = await buildKitchenConfig();
    // A hostname that was never provisioned resolves nowhere; the LAN port is
    // the only thing that actually answers.
    expect(config.mealie.publicUrl).toBeNull();
    expect(config.mealie.port).toBe(10230);
  });

  it('still emits the app when it has no exposure row at all', async () => {
    exposure.getServiceExposureRow.mockResolvedValue(null);

    const config = await buildKitchenConfig();
    expect(Object.keys(config)).toEqual(['mealie', 'pantry']);
    expect(config.pantry).toEqual({ label: 'Pantry', publicUrl: null, port: 10300 });
  });

  it('skips an app that is no longer in the registry', async () => {
    exposure.getServiceExposureRow.mockResolvedValue(null);
    registry.getService.mockImplementation((name: string) => (name === 'mealie' ? { label: 'Mealie' } : undefined));

    const config = await buildKitchenConfig();
    expect(Object.keys(config)).toEqual(['mealie']);
  });
});
