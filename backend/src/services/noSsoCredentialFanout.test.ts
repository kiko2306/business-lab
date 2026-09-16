import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionDocusealTeamMember } from './docusealTeamProvisioning';
import { fanOutNoSsoCredentials, getNoSsoCredentialAppNames } from './noSsoCredentialFanout';

vi.mock('./docusealTeamProvisioning', () => ({ provisionDocusealTeamMember: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedProvision = vi.mocked(provisionDocusealTeamMember);

beforeEach(() => {
  vi.clearAllMocks();
  mockedProvision.mockResolvedValue('created');
});

describe('getNoSsoCredentialAppNames', () => {
  it('lists docuseal, the only app with a provisioner today', () => {
    expect(getNoSsoCredentialAppNames()).toEqual(['docuseal']);
  });
});

describe('fanOutNoSsoCredentials', () => {
  const input = { email: 'bob@example.com', password: 'pw', displayName: 'Bob Jones' };

  it('calls the provisioner for a granted app that has one', async () => {
    await fanOutNoSsoCredentials(['docuseal'], input);
    expect(mockedProvision).toHaveBeenCalledWith(input);
  });

  it('silently skips a granted app with no provisioner (e.g. an Authelia-gated app)', async () => {
    await fanOutNoSsoCredentials(['vaultwarden'], input);
    expect(mockedProvision).not.toHaveBeenCalled();
  });

  it('does not throw when a provisioner rejects, and still processes the rest', async () => {
    mockedProvision.mockRejectedValueOnce(new Error('boom'));
    await expect(fanOutNoSsoCredentials(['docuseal', 'docuseal'], input)).resolves.toBeUndefined();
    expect(mockedProvision).toHaveBeenCalledTimes(2);
  });

  it('does not throw on an already-exists outcome (logged as a warning, not an error)', async () => {
    mockedProvision.mockResolvedValue('already-exists');
    await expect(fanOutNoSsoCredentials(['docuseal'], input)).resolves.toBeUndefined();
  });
});
