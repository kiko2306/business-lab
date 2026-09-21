import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestJson } from '../utils/httpJson';
import { getPublishedUpstreamPort } from '../config/services';
import { publishAlert } from '../utils/alertNotify';
import { runAlertTest } from './alertTest';

vi.mock('../utils/httpJson', () => ({ requestJson: vi.fn() }));
vi.mock('../config/services', () => ({ getPublishedUpstreamPort: vi.fn() }));
vi.mock('../utils/alertNotify', () => ({ publishAlert: vi.fn() }));

const mockedRequest = vi.mocked(requestJson);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedPublishAlert = vi.mocked(publishAlert);

describe('runAlertTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedPort.mockReturnValue(10240);
  });

  it('rejects an unknown source', async () => {
    const res = await runAlertTest('nope' as never);
    expect(res.ok).toBe(false);
  });

  it('POSTs a sample alert array to the n8n relay webhook', async () => {
    mockedRequest.mockResolvedValue({ statusCode: 200, body: null, raw: '' } as never);

    const res = await runAlertTest('crowdsec');

    expect(res.ok).toBe(true);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:10240/webhook/crowdsec-alert');
    expect(opts?.method).toBe('POST');
    expect(Array.isArray(opts?.body)).toBe(true);
    expect((opts?.body as Array<{ scenario: string }>)[0].scenario).toBe('homelab-management/alert-test');
  });

  it('maps a 404 to a "start n8n" hint', async () => {
    mockedRequest.mockResolvedValue({ statusCode: 404, body: null, raw: '' } as never);
    const res = await runAlertTest('crowdsec');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/start n8n/i);
  });

  it('reports a transport failure without throwing', async () => {
    mockedRequest.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await runAlertTest('crowdsec');
    expect(res.ok).toBe(false);
    expect(res.message).toContain('ECONNREFUSED');
  });

  it.each(['critical-service', 'netbird', 'backup'] as const)(
    'publishes a direct sample alert for "%s", since there is no simulated-event source for it',
    async (source) => {
      mockedPublishAlert.mockResolvedValue(true);
      const res = await runAlertTest(source);
      expect(res.ok).toBe(true);
      expect(mockedPublishAlert).toHaveBeenCalledWith(expect.objectContaining({ category: source }));
    }
  );

  it('reports failure when the direct publish could not be delivered', async () => {
    mockedPublishAlert.mockResolvedValue(false);
    const res = await runAlertTest('netbird');
    expect(res.ok).toBe(false);
  });
});
