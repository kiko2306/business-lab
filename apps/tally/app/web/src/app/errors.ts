import { t } from './i18n';

/**
 * A failed request as a sentence for the reader, not a status code or whatever
 * the relay put in its body. The reader's question is "is it them or me", and
 * neither "(0)" nor "ECONNRESET" answers it. A 4xx with a message is the
 * server speaking to the user on purpose, so that one is kept.
 */
export function describeFailure(
  err: { status: number; error?: { error?: string } | null },
  fallback: string,
  /** What a 5xx means on this page: the shop page's is about the shop, the list's is not. */
  serverDown = t('The shop did not answer. Try again in a moment.')
): string {
  if (err.status === 0) {
    return t('Could not reach the server. Check the connection and try again.');
  }
  if (err.status >= 500) {
    return serverDown;
  }
  return err.error?.error ?? fallback;
}
