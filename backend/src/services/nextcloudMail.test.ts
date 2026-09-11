import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { getMailConfig, MailConfig } from '../utils/mailSettings';
import { reconcileNextcloudMail, buildMailScript } from './nextcloudMail';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('../utils/mailSettings', () => ({ getMailConfig: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);
const mockedMail = vi.mocked(getMailConfig);

const resolved = (name: string) => ({
  projectName: name,
  appDir: `/apps/${name}`,
  composeFile: `/apps/${name}/docker-compose.yml`,
  composeArgs: `-f /apps/${name}/docker-compose.yml`,
});

const mail: MailConfig = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'notify@example.com',
  smtpPassword: 'super-secret',
  smtpEncryption: 'tls',
  fromAddress: 'notify@example.com',
  fromName: 'Homelab',
  imapHost: '',
  imapPort: null,
  imapUser: '',
  imapPassword: '',
  imapEncryption: 'ssl',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockImplementation((name: string) => resolved(name) as ReturnType<typeof resolveComposeFile>);
  mockedMail.mockResolvedValue(mail);
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, 'hlm: mail settings copied from the dashboard', '');
  }) as unknown as typeof exec);
});

describe('buildMailScript', () => {
  it('sets the SMTP keys through shell variables, never the literal secret', () => {
    const script = buildMailScript(mail).join('\n');
    expect(script).toContain('mail_smtpmode --value="smtp"');
    expect(script).toContain('mail_smtphost --value="$MAIL_SMTP_HOST"');
    expect(script).toContain('mail_smtppassword --value="$MAIL_SMTP_PASSWORD"');
    expect(script).not.toContain('super-secret');
  });

  it('splits the from-address into mail_from_address (local) + mail_domain', () => {
    const script = buildMailScript(mail).join('\n');
    expect(script).toContain('mail_from_address --value="$MAIL_FROM_LOCAL"');
    expect(script).toContain('mail_domain --value="$MAIL_FROM_DOMAIN"');
  });

  it('skips SMTP entirely with no dashboard mail account configured', () => {
    const script = buildMailScript(null).join('\n');
    expect(script).toContain('no dashboard mail settings configured yet');
    expect(script).not.toContain('config:system:set');
  });
});

describe('reconcileNextcloudMail', () => {
  it('does nothing for any other service', async () => {
    await reconcileNextcloudMail('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs the wiring in a www-data Nextcloud container, passing the password via env', async () => {
    await reconcileNextcloudMail('nextcloud');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const [command, options] = mockedExec.mock.calls[0] as [string, { env?: NodeJS.ProcessEnv }];
    expect(command).toContain('docker compose -p nextcloud');
    expect(command).toContain('-e MAIL_SMTP_PASSWORD');
    expect(command).not.toContain('super-secret');
    expect(options.env?.MAIL_SMTP_PASSWORD).toBe('super-secret');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'boom');
    }) as unknown as typeof exec);
    await expect(reconcileNextcloudMail('nextcloud')).resolves.toBeUndefined();
  });
});
