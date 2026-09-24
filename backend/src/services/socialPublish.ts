/**
 * Sends a social draft as the plan.md §611/§612 slice-1 email advert: one
 * `sendMail()` call per row from `listActiveSubscribers()`, each with that
 * subscriber's own unsubscribe link in the footer — the piece §616 left
 * open.
 */

import { getDraftById } from './socialDrafts';
import { listActiveSubscribers } from './advertSubscribers';
import { sendMail, mailIsConfigured } from '../utils/mailSend';
import { getDashboardBaseUrl } from '../utils/generalSettings';

export class DraftNotFoundError extends Error {
  constructor() {
    super('Draft not found.');
    this.name = 'DraftNotFoundError';
  }
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('Configure the shared mailbox in Settings before publishing.');
    this.name = 'MailNotConfiguredError';
  }
}

export class DashboardUrlMissingError extends Error {
  constructor() {
    super('Set the Dashboard URL in Settings so the unsubscribe link can be built.');
    this.name = 'DashboardUrlMissingError';
  }
}

export interface PublishResult {
  total: number;
  sent: number;
  failed: number;
}

/** The draft's own first non-blank line, since the generated copy has no separate title field. */
function subjectFor(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  if (!firstLine) {
    return 'Update';
  }
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
}

function bodyFor(content: string, unsubscribeUrl: string): string {
  return [content, '', '---', `Unsubscribe: ${unsubscribeUrl}`].join('\n');
}

/**
 * Best-effort per recipient — one subscriber's bounce/SMTP error doesn't stop
 * the rest of the list from being sent to.
 */
export async function publishDraft(draftId: number): Promise<PublishResult> {
  const draft = await getDraftById(draftId);
  if (!draft) {
    throw new DraftNotFoundError();
  }
  if (!(await mailIsConfigured())) {
    throw new MailNotConfiguredError();
  }
  const baseUrl = await getDashboardBaseUrl();
  if (!baseUrl) {
    throw new DashboardUrlMissingError();
  }

  const subject = subjectFor(draft.content);
  const subscribers = await listActiveSubscribers();
  let sent = 0;
  let failed = 0;
  for (const subscriber of subscribers) {
    try {
      await sendMail({
        to: subscriber.email,
        subject,
        text: bodyFor(draft.content, `${baseUrl}/unsubscribe/${subscriber.unsubscribeToken}`),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('Social draft publish send failed:', (error as Error).message);
    }
  }
  return { total: subscribers.length, sent, failed };
}
