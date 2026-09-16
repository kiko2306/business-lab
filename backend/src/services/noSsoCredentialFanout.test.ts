import { beforeEach, describe, expect, it, vi } from 'vitest';
import { disableDocusealTeamMember, provisionDocusealTeamMember } from './docusealTeamProvisioning';
import { disableHomeAssistantUser, provisionHomeAssistantUser } from './homeAssistantUserProvisioning';
import { disableItflowUser, provisionItflowUser } from './itflowUserProvisioning';
import { disableKimaiUser, provisionKimaiUser } from './kimaiUserProvisioning';
import { disableNocodbUser, provisionNocodbUser } from './nocodbUserProvisioning';
import { deprovisionNoSsoCredentials, fanOutNoSsoCredentials, getNoSsoCredentialAppNames } from './noSsoCredentialFanout';

vi.mock('./docusealTeamProvisioning', () => ({ provisionDocusealTeamMember: vi.fn(), disableDocusealTeamMember: vi.fn() }));
vi.mock('./nocodbUserProvisioning', () => ({ provisionNocodbUser: vi.fn(), disableNocodbUser: vi.fn() }));
vi.mock('./itflowUserProvisioning', () => ({ provisionItflowUser: vi.fn(), disableItflowUser: vi.fn() }));
vi.mock('./kimaiUserProvisioning', () => ({ provisionKimaiUser: vi.fn(), disableKimaiUser: vi.fn() }));
vi.mock('./homeAssistantUserProvisioning', () => ({ provisionHomeAssistantUser: vi.fn(), disableHomeAssistantUser: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedProvision = vi.mocked(provisionDocusealTeamMember);
const mockedProvisionNocodb = vi.mocked(provisionNocodbUser);
const mockedProvisionItflow = vi.mocked(provisionItflowUser);
const mockedProvisionKimai = vi.mocked(provisionKimaiUser);
const mockedProvisionHa = vi.mocked(provisionHomeAssistantUser);
const mockedDisableDocuseal = vi.mocked(disableDocusealTeamMember);
const mockedDisableNocodb = vi.mocked(disableNocodbUser);
const mockedDisableItflow = vi.mocked(disableItflowUser);
const mockedDisableKimai = vi.mocked(disableKimaiUser);
const mockedDisableHa = vi.mocked(disableHomeAssistantUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockedProvision.mockResolvedValue('created');
  mockedProvisionNocodb.mockResolvedValue('created');
  mockedProvisionItflow.mockResolvedValue('created');
  mockedProvisionKimai.mockResolvedValue('created');
  mockedProvisionHa.mockResolvedValue('created');
  mockedDisableDocuseal.mockResolvedValue('disabled');
  mockedDisableNocodb.mockResolvedValue('disabled');
  mockedDisableItflow.mockResolvedValue('disabled');
  mockedDisableKimai.mockResolvedValue('disabled');
  mockedDisableHa.mockResolvedValue('disabled');
});

describe('getNoSsoCredentialAppNames', () => {
  it('lists every app with a provisioner today', () => {
    expect(getNoSsoCredentialAppNames()).toEqual(['docuseal', 'nocodb', 'itflow', 'kimai', 'home-assistant', 'jellyfin']);
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

describe('deprovisionNoSsoCredentials', () => {
  it('calls the deprovisioner for a revoked app that has one', async () => {
    await deprovisionNoSsoCredentials(['docuseal'], 'bob@example.com');
    expect(mockedDisableDocuseal).toHaveBeenCalledWith('bob@example.com');
  });

  it('silently skips a revoked app with no deprovisioner', async () => {
    await deprovisionNoSsoCredentials(['vaultwarden'], 'bob@example.com');
    expect(mockedDisableDocuseal).not.toHaveBeenCalled();
    expect(mockedDisableNocodb).not.toHaveBeenCalled();
    expect(mockedDisableItflow).not.toHaveBeenCalled();
    expect(mockedDisableKimai).not.toHaveBeenCalled();
    expect(mockedDisableHa).not.toHaveBeenCalled();
  });

  it('does not throw when a deprovisioner rejects, and still processes the rest', async () => {
    mockedDisableDocuseal.mockRejectedValueOnce(new Error('boom'));
    await expect(deprovisionNoSsoCredentials(['docuseal', 'nocodb'], 'bob@example.com')).resolves.toBeUndefined();
    expect(mockedDisableNocodb).toHaveBeenCalledWith('bob@example.com');
  });

  it('calls each of the five deprovisioners for their own app', async () => {
    await deprovisionNoSsoCredentials(['docuseal', 'nocodb', 'itflow', 'kimai', 'home-assistant'], 'bob@example.com');
    expect(mockedDisableDocuseal).toHaveBeenCalledWith('bob@example.com');
    expect(mockedDisableNocodb).toHaveBeenCalledWith('bob@example.com');
    expect(mockedDisableItflow).toHaveBeenCalledWith('bob@example.com');
    expect(mockedDisableKimai).toHaveBeenCalledWith('bob@example.com');
    expect(mockedDisableHa).toHaveBeenCalledWith('bob@example.com');
  });
});
