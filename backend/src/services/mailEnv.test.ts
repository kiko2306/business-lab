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

describe('buildMailEnvOverrides — encryption vocabulary', () => {
  beforeEach(() => {
    mockedGetService.mockReset();
    mockedGetMailConfig.mockReset();
  });

  it("translates to the app's own vocabulary when a map is given", async () => {
    // Vaultwarden's shape. Passing 'tls' through verbatim would leave it
    // unencrypted and it would not complain, so this mapping is load-bearing.
    mockedGetService.mockReturnValue({
      mailEnvKeys: {
        smtpEncryption: ['SMTP_SECURITY'],
        smtpEncryptionMap: { tls: 'starttls', ssl: 'force_tls', none: 'off' },
      },
    } as never);

    for (const [ours, theirs] of [['tls', 'starttls'], ['ssl', 'force_tls'], ['none', 'off']] as const) {
      mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: ours });
      expect(await buildMailEnvOverrides('vaultwarden')).toEqual({ SMTP_SECURITY: theirs });
    }
  });

  it('passes the value through when no map is given', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: { smtpEncryption: ['MAIL_ENCRYPTION'] } } as never);
    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    expect(await buildMailEnvOverrides('x')).toEqual({ MAIL_ENCRYPTION: 'ssl' });
  });

  it('applies only the flag set for the configured mode (Paperless / n8n shape)', async () => {
    // Two mutually-exclusive booleans whose values differ per mode — neither a
    // single named scheme nor one boolean can express this.
    mockedGetService.mockReturnValue({
      mailEnvKeys: {
        smtpEncryptionFlags: {
          tls: { USE_TLS: 'true', USE_SSL: 'false' },
          ssl: { USE_TLS: 'false', USE_SSL: 'true' },
          none: { USE_TLS: 'false', USE_SSL: 'false' },
        },
      },
    } as never);

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'tls' });
    expect(await buildMailEnvOverrides('x')).toEqual({ USE_TLS: 'true', USE_SSL: 'false' });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    expect(await buildMailEnvOverrides('x')).toEqual({ USE_TLS: 'false', USE_SSL: 'true' });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'none' });
    expect(await buildMailEnvOverrides('x')).toEqual({ USE_TLS: 'false', USE_SSL: 'false' });
  });
});

describe('mail wiring for the registry apps (§75.6 retrofit)', () => {
  beforeEach(() => {
    mockedGetService.mockReset();
    mockedGetMailConfig.mockReset();
    mockedGetMailConfig.mockResolvedValue(fullConfig); // tls, port 587
  });

  async function realKeysFor(name: string) {
    const { SERVICES } = await vi.importActual<typeof import('../config/services')>('../config/services');
    return SERVICES[name].mailEnvKeys;
  }

  it('BookStack: every var BookStack reads, ssl collapsed onto tls', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: await realKeysFor('bookstack') } as never);

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    expect(await buildMailEnvOverrides('bookstack')).toEqual({
      BOOKSTACK_MAIL_DRIVER: 'smtp',
      BOOKSTACK_MAIL_HOST: 'smtp.example.com',
      BOOKSTACK_MAIL_PORT: '587',
      BOOKSTACK_MAIL_USERNAME: 'bot@example.com',
      BOOKSTACK_MAIL_PASSWORD: 'hunter2',
      // Symfony mailer only knows tls/null; port 465 implies implicit TLS.
      BOOKSTACK_MAIL_ENCRYPTION: 'tls',
      BOOKSTACK_MAIL_FROM: 'bot@example.com',
      BOOKSTACK_MAIL_FROM_NAME: 'Homelab',
    });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'none' });
    expect((await buildMailEnvOverrides('bookstack')).BOOKSTACK_MAIL_ENCRYPTION).toBe('null');
  });

  it('n8n: turns the mode on and sets both encryption booleans explicitly', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: await realKeysFor('n8n') } as never);

    expect(await buildMailEnvOverrides('n8n')).toEqual({
      N8N_EMAIL_MODE: 'smtp',
      N8N_SMTP_HOST: 'smtp.example.com',
      N8N_SMTP_PORT: '587',
      N8N_SMTP_USER: 'bot@example.com',
      N8N_SMTP_PASS: 'hunter2',
      N8N_SMTP_SENDER: 'bot@example.com',
      // STARTTLS on 587; n8n's own default of SSL=true would break it.
      N8N_SMTP_SSL: 'false',
      N8N_SMTP_STARTTLS: 'true',
    });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    const ssl = await buildMailEnvOverrides('n8n');
    expect([ssl.N8N_SMTP_SSL, ssl.N8N_SMTP_STARTTLS]).toEqual(['true', 'false']);
  });

  it('Paperless: sending vars only, USE_TLS/USE_SSL mutually exclusive, no IMAP', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: await realKeysFor('paperless') } as never);

    const out = await buildMailEnvOverrides('paperless');
    expect(out).toEqual({
      PAPERLESS_EMAIL_HOST: 'smtp.example.com',
      PAPERLESS_EMAIL_PORT: '587',
      PAPERLESS_EMAIL_HOST_USER: 'bot@example.com',
      PAPERLESS_EMAIL_HOST_PASSWORD: 'hunter2',
      PAPERLESS_EMAIL_FROM: 'bot@example.com',
      PAPERLESS_EMAIL_USE_TLS: 'true',
      PAPERLESS_EMAIL_USE_SSL: 'false',
    });
    // Document intake stays a separate per-account UI setting.
    expect(Object.keys(out).some((k) => k.includes('IMAP') || k.includes('MAIL_IMAP'))).toBe(false);
  });

  it('Vikunja: enables the mailer and only forces SSL for implicit TLS', async () => {
    mockedGetService.mockReturnValue({ mailEnvKeys: await realKeysFor('vikunja') } as never);

    expect(await buildMailEnvOverrides('vikunja')).toEqual({
      VIKUNJA_MAILER_ENABLED: 'true',
      VIKUNJA_MAILER_HOST: 'smtp.example.com',
      VIKUNJA_MAILER_PORT: '587',
      VIKUNJA_MAILER_USERNAME: 'bot@example.com',
      VIKUNJA_MAILER_PASSWORD: 'hunter2',
      VIKUNJA_MAILER_FROMEMAIL: 'bot@example.com',
      VIKUNJA_MAILER_FORCESSL: 'false',
    });

    mockedGetMailConfig.mockResolvedValue({ ...fullConfig, smtpEncryption: 'ssl' });
    expect((await buildMailEnvOverrides('vikunja')).VIKUNJA_MAILER_FORCESSL).toBe('true');
  });

  it('all four fall back to nothing when mail is unconfigured', async () => {
    mockedGetMailConfig.mockResolvedValue(null);
    for (const name of ['bookstack', 'n8n', 'paperless', 'vikunja']) {
      mockedGetService.mockReturnValue({ mailEnvKeys: await realKeysFor(name) } as never);
      expect(await buildMailEnvOverrides(name)).toEqual({});
    }
  });

  it('Uptime Kuma declares no mail keys — it has no SMTP env vars', async () => {
    const { SERVICES } = await vi.importActual<typeof import('../config/services')>('../config/services');
    expect(SERVICES['uptime-kuma'].mailEnvKeys).toBeUndefined();
  });
});

describe('vaultwarden mail wiring', () => {
  it('maps every SMTP var vaultwarden actually reads', async () => {
    const { SERVICES } = await vi.importActual<typeof import('../config/services')>('../config/services');
    const keys = SERVICES['vaultwarden'].mailEnvKeys;
    expect(keys?.smtpHost).toEqual(['SMTP_HOST']);
    expect(keys?.fromAddress).toEqual(['SMTP_FROM']);
    // The map is the part that silently breaks if dropped.
    expect(keys?.smtpEncryptionMap).toEqual({ tls: 'starttls', ssl: 'force_tls', none: 'off' });
  });
});
