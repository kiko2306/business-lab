import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDraftById, recordSend } from './socialDrafts';
import { listActiveSubscribers } from './advertSubscribers';
import { sendMail, mailIsConfigured } from '../utils/mailSend';
import { getDashboardBaseUrl } from '../utils/generalSettings';
import { publishDraft, previewPublish, DraftNotFoundError, MailNotConfiguredError, DashboardUrlMissingError } from './socialPublish';

vi.mock('./socialDrafts', () => ({ getDraftById: vi.fn(), recordSend: vi.fn() }));
vi.mock('./advertSubscribers', () => ({
  listActiveSubscribers: vi.fn(),
  senderFromBaseUrl: (url: string | null) => (url ? new URL(url).host : null),
}));
vi.mock('../utils/mailSend', () => ({ sendMail: vi.fn(), mailIsConfigured: vi.fn() }));
vi.mock('../utils/generalSettings', () => ({ getDashboardBaseUrl: vi.fn() }));

const mockedGetDraftById = vi.mocked(getDraftById);
const mockedRecordSend = vi.mocked(recordSend);
const mockedListActiveSubscribers = vi.mocked(listActiveSubscribers);
const mockedSendMail = vi.mocked(sendMail);
const mockedMailIsConfigured = vi.mocked(mailIsConfigured);
const mockedGetDashboardBaseUrl = vi.mocked(getDashboardBaseUrl);

const draft = {
  id: 1,
  prompt: 'Announce the new feature',
  content: 'We just shipped group reservations!\nTry it today.',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastSentAt: null,
  lastSentCount: null,
};

beforeEach(() => {
  mockedGetDraftById.mockReset();
  mockedRecordSend.mockReset();
  mockedListActiveSubscribers.mockReset();
  mockedSendMail.mockReset();
  mockedMailIsConfigured.mockReset();
  mockedGetDashboardBaseUrl.mockReset();

  mockedGetDraftById.mockResolvedValue(draft);
  mockedMailIsConfigured.mockResolvedValue(true);
  mockedGetDashboardBaseUrl.mockResolvedValue('https://dash.example.com');
});

describe('publishDraft', () => {
  it('throws when the draft does not exist', async () => {
    mockedGetDraftById.mockResolvedValue(null);
    await expect(publishDraft(99)).rejects.toBeInstanceOf(DraftNotFoundError);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('throws when the shared mailbox is not configured', async () => {
    mockedMailIsConfigured.mockResolvedValue(false);
    await expect(publishDraft(1)).rejects.toBeInstanceOf(MailNotConfiguredError);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('throws when no dashboard base URL can be built', async () => {
    mockedGetDashboardBaseUrl.mockResolvedValue(null);
    await expect(publishDraft(1)).rejects.toBeInstanceOf(DashboardUrlMissingError);
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('sends one message per active subscriber, each with its own unsubscribe link', async () => {
    mockedListActiveSubscribers.mockResolvedValue([
      { email: 'a@example.com', unsubscribeToken: 'token-a' },
      { email: 'b@example.com', unsubscribeToken: 'token-b' },
    ]);
    mockedSendMail.mockResolvedValue(undefined);

    const result = await publishDraft(1);

    expect(result).toEqual({ total: 2, sent: 2, failed: 0 });
    expect(mockedSendMail).toHaveBeenCalledTimes(2);
    expect(mockedSendMail).toHaveBeenNthCalledWith(1, expect.objectContaining({
      to: 'a@example.com',
      subject: 'We just shipped group reservations!',
      text: expect.stringContaining('https://dash.example.com/unsubscribe/token-a'),
    }));
    expect(mockedSendMail).toHaveBeenNthCalledWith(2, expect.objectContaining({
      to: 'b@example.com',
      subject: 'We just shipped group reservations!',
      text: expect.stringContaining('https://dash.example.com/unsubscribe/token-b'),
    }));
  });

  it('keeps sending to the rest of the list when one recipient fails', async () => {
    mockedListActiveSubscribers.mockResolvedValue([
      { email: 'a@example.com', unsubscribeToken: 'token-a' },
      { email: 'b@example.com', unsubscribeToken: 'token-b' },
    ]);
    mockedSendMail.mockRejectedValueOnce(new Error('SMTP rejected')).mockResolvedValueOnce(undefined);

    const result = await publishDraft(1);

    expect(result).toEqual({ total: 2, sent: 1, failed: 1 });
    expect(mockedSendMail).toHaveBeenCalledTimes(2);
  });

  it('reports zero sent with no active subscribers, without calling sendMail', async () => {
    mockedListActiveSubscribers.mockResolvedValue([]);

    await expect(publishDraft(1)).resolves.toEqual({ total: 0, sent: 0, failed: 0 });
    expect(mockedSendMail).not.toHaveBeenCalled();
  });

  it('falls back to a generic subject when the draft content is blank', async () => {
    mockedGetDraftById.mockResolvedValue({ ...draft, content: '   \n  ' });
    mockedListActiveSubscribers.mockResolvedValue([{ email: 'a@example.com', unsubscribeToken: 'token-a' }]);
    mockedSendMail.mockResolvedValue(undefined);

    await publishDraft(1);

    expect(mockedSendMail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Update' }));
  });
});

// plan.md §845 fix 3: a draft remembers that it went out, and the confirm can say
// to how many and under what subject before anything is sent.
describe('publishDraft records the send', () => {
  it('stores how many were sent, so the draft can say "Sent <date> to N"', async () => {
    mockedListActiveSubscribers.mockResolvedValue([
      { email: 'a@example.com', unsubscribeToken: 'token-a' },
      { email: 'b@example.com', unsubscribeToken: 'token-b' },
    ]);
    mockedSendMail.mockResolvedValue(undefined);

    await publishDraft(1);

    expect(mockedRecordSend).toHaveBeenCalledWith(1, 2);
  });

  it('counts only the messages that left, not the ones that bounced', async () => {
    mockedListActiveSubscribers.mockResolvedValue([
      { email: 'a@example.com', unsubscribeToken: 'token-a' },
      { email: 'b@example.com', unsubscribeToken: 'token-b' },
    ]);
    mockedSendMail.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SMTP rejected'));

    await publishDraft(1);

    expect(mockedRecordSend).toHaveBeenCalledWith(1, 1);
  });

  it('records nothing when nothing was sent', async () => {
    mockedListActiveSubscribers.mockResolvedValue([]);
    await publishDraft(1);
    expect(mockedRecordSend).not.toHaveBeenCalled();
  });
});

describe('previewPublish', () => {
  it('gives the subject the send would use and the number of active recipients, for any text', async () => {
    mockedListActiveSubscribers.mockResolvedValue([
      { email: 'a@example.com', unsubscribeToken: 'token-a' },
      { email: 'b@example.com', unsubscribeToken: 'token-b' },
    ]);

    await expect(previewPublish('\n  Big sale this week\nEverything must go')).resolves.toEqual({
      subject: 'Big sale this week',
      recipients: 2,
    });
  });

  it('uses the same fallback subject as the send', async () => {
    mockedListActiveSubscribers.mockResolvedValue([]);
    await expect(previewPublish('   ')).resolves.toEqual({ subject: 'Update', recipients: 0 });
  });
});

// plan.md §854 fix 2: say whose emails these are, and let the mail client offer its own
// one-click unsubscribe (RFC 8058) — without it, big inboxes treat bulk mail as suspect.
describe('publishDraft unsubscribe affordances', () => {
  const send = async () => {
    mockedListActiveSubscribers.mockResolvedValue([{ email: 'a@example.com', unsubscribeToken: 'token-a' }]);
    mockedSendMail.mockResolvedValue(undefined);
    await publishDraft(1);
    return mockedSendMail.mock.calls[0][0];
  };

  it('names the sender in the footer, ahead of the unsubscribe link', async () => {
    const mail = await send();
    expect(mail.text).toContain('You are receiving this because you subscribed to dash.example.com.');
    expect(mail.text.indexOf('dash.example.com.')).toBeLessThan(mail.text.indexOf('Unsubscribe: https://'));
  });

  it('adds List-Unsubscribe pointing at the POST route, and the one-click marker', async () => {
    const mail = await send();
    expect(mail.headers).toEqual({
      'List-Unsubscribe': '<https://dash.example.com/api/subscribers/unsubscribe/token-a>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});
