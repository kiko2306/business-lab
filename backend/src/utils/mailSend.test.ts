import { describe, expect, it, vi, beforeEach } from 'vitest';
import nodemailer from 'nodemailer';
import { getMailConfig } from './mailSettings';
import { sendMail } from './mailSend';

const sendMailSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailSpy, close: vi.fn() })) },
}));
vi.mock('./mailSettings', () => ({ getMailConfig: vi.fn() }));

beforeEach(() => {
  sendMailSpy.mockClear();
  vi.mocked(nodemailer.createTransport).mockClear();
  vi.mocked(getMailConfig).mockResolvedValue({
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpEncryption: 'tls',
    smtpUser: 'u',
    smtpPassword: 'p',
    fromAddress: 'shop@example.com',
    fromName: 'Shop',
  } as never);
});

describe('sendMail headers', () => {
  it('passes extra headers through (List-Unsubscribe for bulk mail, plan.md §854)', async () => {
    await sendMail({ to: 'a@example.com', subject: 's', text: 't', headers: { 'List-Unsubscribe': '<https://x>' } });
    expect(sendMailSpy).toHaveBeenCalledWith(expect.objectContaining({ headers: { 'List-Unsubscribe': '<https://x>' } }));
  });

  it('leaves headers off a message that has none, so invite mail is unchanged', async () => {
    await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
    expect(sendMailSpy.mock.calls[0][0].headers).toBeUndefined();
  });
});
