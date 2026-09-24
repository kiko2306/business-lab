import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getDraftById } from './socialDrafts';
import { listActiveSubscribers } from './advertSubscribers';
import { sendMail, mailIsConfigured } from '../utils/mailSend';
import { getDashboardBaseUrl } from '../utils/generalSettings';
import { publishDraft, DraftNotFoundError, MailNotConfiguredError, DashboardUrlMissingError } from './socialPublish';

vi.mock('./socialDrafts', () => ({ getDraftById: vi.fn() }));
vi.mock('./advertSubscribers', () => ({ listActiveSubscribers: vi.fn() }));
vi.mock('../utils/mailSend', () => ({ sendMail: vi.fn(), mailIsConfigured: vi.fn() }));
vi.mock('../utils/generalSettings', () => ({ getDashboardBaseUrl: vi.fn() }));

const mockedGetDraftById = vi.mocked(getDraftById);
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
};

beforeEach(() => {
  mockedGetDraftById.mockReset();
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
    expect(mockedSendMail).toHaveBeenNthCalledWith(1, {
      to: 'a@example.com',
      subject: 'We just shipped group reservations!',
      text: expect.stringContaining('https://dash.example.com/unsubscribe/token-a'),
    });
    expect(mockedSendMail).toHaveBeenNthCalledWith(2, {
      to: 'b@example.com',
      subject: 'We just shipped group reservations!',
      text: expect.stringContaining('https://dash.example.com/unsubscribe/token-b'),
    });
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
