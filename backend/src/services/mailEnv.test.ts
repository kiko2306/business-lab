import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/services', () => ({ getService: vi.fn() }));
vi.mock('../utils/mailSettings', async () => {
  const actual = await vi.importActual<typeof import('../utils/mailSettings')>('../utils/mailSettings');
  return { ...actual, getMailConfig: vi.fn() };
});

import { getService } from '../config/services';
import { getMailConfig } from '../utils/mailSettings';
import { buildMailEnvOverrides } from './mailEnv';

const mockedGetService = vi.mocked(getService);
const mockedGetMailConfig = vi.mocked(getMailConfig);

const fullConfig = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'bot@example.com',
  smtpPassword: 'hunter2',
  smtpEncryption: 'tls' as const,
  fromAddress: 'bot@example.com',
  fromName: 'Homelab',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapUser: 'bot@example.com',
  imapPassword: 'hunter2',
  imapEncryption: 'ssl' as const,
};

describe('buildMailEnvOverrides', () => {
  beforeEach(() => {
    mockedGetService.mockReset();
    mockedGetMailConfig.mockReset();
  });

  it('returns nothing when the service declares no mail keys', async () => {
    mockedGetService.mockReturnValue({ name: 'x' } as never);
    expect(await buildMailEnvOverrides('x')).toEqual({});
    // Must not even read the settings — an app that doesn't want mail
    // shouldn't pay a database round-trip on every start.
    expect(mockedGetMailConfig).not.toHaveBeenCalled();
  });

  it('returns nothing when mail is not configured, rather than failing the start', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: { smtpHost: ['SMTP_HOST'] } } as never);
    mockedGetMailConfig.mockResolvedValue(null);
    expect(await buildMailEnvOverrides('x')).toEqual({});
  });

  it('maps each setting onto every env name the service declares', async () => {
    mockedGetService.mockReturnValue({
      mailEnvKeys: {
        smtpHost: ['SMTP_HOST', 'MAIL_HOST'],
        smtpPort: ['SMTP_PORT'],
        smtpPassword: ['SMTP_PASS'],
        fromAddress: ['MAIL_FROM'],
        staticWhenConfigured: { MAIL_ENABLED: 'true' },
      },
    } as never);
    mockedGetMailConfig.mockResolvedValue(fullConfig);

    expect(await buildMailEnvOverrides('x')).toEqual({
      SMTP_HOST: 'smtp.example.com',
      MAIL_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_PASS: 'hunter2',
      MAIL_FROM: 'bot@example.com',
      MAIL_ENABLED: 'true',
    });
  });

  it('translates encryption to a boolean for apps that want one', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: { smtpTlsBoolean: ['SMTP_SECURE'] } } as never);

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'none' });
    expect(await buildMailEnvOverrides('x')).toEqual({ SMTP_SECURE: 'false' });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    expect(await buildMailEnvOverrides('x')).toEqual({ SMTP_SECURE: 'true' });
  });

  it('omits IMAP entirely when receiving is not set up', async () => {
    // Sending without receiving is the common case; an app must not be handed
    // a half-configured IMAP block that it then tries to connect to.
    mockedGetService.mockReturnValue({
      mailEnvKeys: { smtpHost: ['SMTP_HOST'], imapHost: ['IMAP_HOST'], imapUser: ['IMAP_USER'] },
    } as never);
    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, imapHost: '', imapPort: null });

    expect(await buildMailEnvOverrides('x')).toEqual({ SMTP_HOST: 'smtp.example.com' });
  });
});
