/**
 * Waiting helpers for the per-app reconcilers that run after `docker compose
 * up` (executor.ts's POST_UP_RECONCILERS).
 *
 * `up` returns once the containers are *created*, which is well before an
 * app's own HTTP or database layer answers — so every bootstrap that drives a
 * freshly-started app has to poll it first. Thirteen modules had their own
 * copy of `sleep`, and nine the same "probe, retry while unreachable, give up
 * on the last attempt" wrapper around their real work.
 */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Call `probe` until `isReady` accepts its result, or the attempts run out,
 * sleeping `delayMs` between tries. Returns the last result either way.
 *
 * Deliberately does **not** decide what giving up means: each caller words its
 * own warning, and several have real work to do on a not-ready result (ITFlow
 * and DocuSeal reconcile an existing admin instead). Returning the value and
 * letting the caller branch keeps that where it is readable.
 *
 * `attempts` counts probes, not retries — one immediately, then up to
 * `attempts - 1` more with a sleep before each, which is what the hand-written
 * loops this replaces did.
 */
export async function pollUntilReady<T>(
  probe: () => Promise<T>,
  isReady: (result: T) => boolean,
  attempts: number,
  delayMs: number
): Promise<T> {
  let result = await probe();
  for (let attempt = 1; attempt < attempts && !isReady(result); attempt += 1) {
    await sleep(delayMs);
    result = await probe();
  }
  return result;
}
