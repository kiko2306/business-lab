import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailConfig } from '../utils/mailSettings';

const db = vi.hoisted(() => ({ runItflowDbScript: vi.fn() }));
const mailSettings = vi.hoisted(() => ({ getMailConfig: vi.fn() }));
const registry = vi.hoisted(() => ({ resolveComposeFile: vi.fn() }));

vi.mock('./itflowDb', () => db);
vi.mock('../utils/mailSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/mailSettings')>()),
  getMailConfig: mailSettings.getMailConfig,
}));
vi.mock('../config/services', () => registry);
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { buildMailCronScript, reconcileItflowMailCron } from './itflowMailCron';

const sendingOnly: MailConfig = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'user@example.com',
  smtpPassword: 'hunter2',
  smtpEncryption: 'tls',
  fromAddress: 'noreply@example.com',
  fromName: 'Example',
  imapHost: '',
  imapPort: null,
  imapUser: '',
  imapPassword: '',
  imapEncryption: 'ssl',
};

const withImap: MailConfig = {
  ...sendingOnly,
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapUser: 'user@example.com',
  imapPassword: 'imapsecret',
  imapEncryption: 'ssl',
};

describe('buildMailCronScript', () => {
  it('always enables the master cron switch', () => {
    expect(buildMailCronScript(null).join('\n')).toContain('config_enable_cron = 1');
  });

  it('skips SMTP/IMAP and says so when no dashboard mail config exists yet', () => {
    const script = buildMailCronScript(null).join('\n');
    expect(script).toContain('no dashboard mail settings configured yet');
    expect(script).not.toContain('config_smtp_provider');
  });

  it('writes SMTP settings via a prepared statement, values read from getenv only', () => {
    const script = buildMailCronScript(sendingOnly).join('\n');
    expect(script).toContain("config_smtp_provider = 'standard_smtp'");
    expect(script).toContain('$stmt->bind_param(');
    expect(script).toContain("getenv('ITFLOW_SMTP_HOST')");
    // No secret or literal config value ever appears inline in the script.
    expect(script).not.toContain('hunter2');
    expect(script).not.toContain('smtp.example.com');
  });

  it('only writes IMAP settings when the dashboard has an IMAP host configured', () => {
    expect(buildMailCronScript(sendingOnly).join('\n')).not.toContain('config_imap_provider');
    const withImapScript = buildMailCronScript(withImap).join('\n');
    expect(withImapScript).toContain("config_imap_provider = 'standard_imap'");
    expect(withImapScript).toContain("getenv('ITFLOW_IMAP_HOST')");
  });
});

describe('reconcileItflowMailCron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.resolveComposeFile.mockReturnValue({ composeFile: '/apps/itflow/docker-compose.yml' });
    db.runItflowDbScript.mockResolvedValue({ ok: true, output: 'hlm: cron enabled' });
  });

  it('is a no-op for a non-itflow service', async () => {
    await reconcileItflowMailCron('paperless');
    expect(db.runItflowDbScript).not.toHaveBeenCalled();
  });

  it('does nothing when itflow is not installed', async () => {
    registry.resolveComposeFile.mockReturnValue({ composeFile: null });
    await reconcileItflowMailCron('itflow');
    expect(db.runItflowDbScript).not.toHaveBeenCalled();
  });

  it('passes SMTP/IMAP secrets through the environment, not the script', async () => {
    mailSettings.getMailConfig.mockResolvedValue(withImap);

    await reconcileItflowMailCron('itflow');

    expect(db.runItflowDbScript).toHaveBeenCalledTimes(1);
    const [, opts] = db.runItflowDbScript.mock.calls[0];
    expect(opts.env.ITFLOW_SMTP_PASSWORD).toBe('hunter2');
    expect(opts.env.ITFLOW_IMAP_PASSWORD).toBe('imapsecret');
    expect(opts.passEnv).toEqual(expect.arrayContaining(['ITFLOW_SMTP_PASSWORD', 'ITFLOW_IMAP_PASSWORD']));
  });

  it('redacts any secret that leaks back in the command output before logging', async () => {
    mailSettings.getMailConfig.mockResolvedValue(sendingOnly);
    db.runItflowDbScript.mockResolvedValue({ ok: false, output: 'connection failed for password hunter2' });

    const loggerModule = await import('../utils/logger');
    await reconcileItflowMailCron('itflow');

    const infoCall = (loggerModule.default.info as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(infoCall[1].output).not.toContain('hunter2');
    expect(infoCall[1].output).toContain('***');
  });

  it('never throws when the underlying script run fails', async () => {
    mailSettings.getMailConfig.mockResolvedValue(null);
    db.runItflowDbScript.mockRejectedValue(new Error('boom'));
    await expect(reconcileItflowMailCron('itflow')).resolves.toBeUndefined();
  });
});
