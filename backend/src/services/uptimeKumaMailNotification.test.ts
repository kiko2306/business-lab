import { describe, expect, it } from 'vitest';
import { buildSmtpNotification, findExistingId, NOTIFICATION_NAME } from './uptimeKumaMailNotification';

const mail = {
  smtpHost: 'mail.example.com',
  smtpPort: 587,
  smtpUser: 'bot@example.com',
  smtpPassword: 'pw',
  smtpEncryption: 'tls',
  fromAddress: 'alerts@example.com',
  fromName: 'Business Lab',
};

describe('findExistingId', () => {
  // Missing an existing entry means a duplicate notification on every start.
  it('finds our notification by name in a notificationList frame', () => {
    const args = ['notificationList', [{ id: 3, name: 'Other' }, { id: 9, name: NOTIFICATION_NAME }]];
    expect(findExistingId(args, NOTIFICATION_NAME)).toBe(9);
  });

  it('returns null for any other frame or an empty list', () => {
    expect(findExistingId(['notificationList', []], NOTIFICATION_NAME)).toBeNull();
    expect(findExistingId(['monitorList', {}], NOTIFICATION_NAME)).toBeNull();
    expect(findExistingId(undefined, NOTIFICATION_NAME)).toBeNull();
    expect(findExistingId(['notificationList', [{ name: NOTIFICATION_NAME }]], NOTIFICATION_NAME)).toBeNull();
  });
});

describe('buildSmtpNotification', () => {
  // smtpSecure is implicit TLS only: setting it for STARTTLS makes
  // nodemailer speak TLS at a plaintext port and the send just fails.
  it('sets smtpSecure only for implicit TLS', () => {
    expect(buildSmtpNotification({ ...mail, smtpEncryption: 'ssl' }, 'me@example.com').smtpSecure).toBe(true);
    expect(buildSmtpNotification({ ...mail, smtpEncryption: 'tls' }, 'me@example.com').smtpSecure).toBe(false);
    expect(buildSmtpNotification({ ...mail, smtpEncryption: 'none' }, 'me@example.com').smtpSecure).toBe(false);
  });

  it('builds a display-name From when there is one, a bare address otherwise', () => {
    expect(buildSmtpNotification(mail, 'me@example.com').smtpFrom).toBe('Business Lab <alerts@example.com>');
    expect(buildSmtpNotification({ ...mail, fromName: '' }, 'me@example.com').smtpFrom).toBe('alerts@example.com');
  });

  // Without these two, the notification covers only monitors created later.
  it('is default and applies to existing monitors', () => {
    const n = buildSmtpNotification(mail, 'me@example.com');
    expect(n.isDefault).toBe(true);
    expect(n.applyExisting).toBe(true);
    expect(n.type).toBe('smtp');
    expect(n.smtpTo).toBe('me@example.com');
  });
});
