import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { describeApp } from './accessRequests';

vi.mock('../utils/database', () => ({ query: vi.fn() }));

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('describeApp', () => {
  it('names the app alongside its hostname when the exposure row is found', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ service_name: 'paperless' }] } as never);

    await expect(describeApp('paperless.example.com')).resolves.toBe('Paperless (paperless.example.com)');
  });

  it('strips a secondary exposure suffix to find the base service label', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ service_name: 'netbird-vpn:api' }] } as never);

    await expect(describeApp('netbird-vpn-api.example.com')).resolves.toBe('Netbird VPN (netbird-vpn-api.example.com)');
  });

  it('falls back to the bare hostname when no exposure row matches', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    await expect(describeApp('unknown.example.com')).resolves.toBe('unknown.example.com');
  });
});
