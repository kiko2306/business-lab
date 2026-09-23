import crypto from 'crypto';

/**
 * Enrolment codes and agent tokens (plan.md §627).
 *
 * ponytail: a copy of apps/tally/api/src/tokens.ts, not a shared module. Each
 * app image builds from its own context and cannot reach a sibling, the same
 * wall the theme hit (§633) — and a package mechanism for ~50 lines of crypto
 * costs more than it saves. If a third app needs these, share them properly
 * rather than copying again.
 *
 * Both are hashed with a plain SHA-256 before storage, deliberately — not
 * bcrypt/argon2. Those exist to make *low-entropy* human passwords expensive to
 * guess. These are 160+ bits of CSPRNG output, so there is nothing to brute
 * force, and a fast hash keeps the agent's auth lookup a single indexed query
 * rather than a per-request KDF.
 */

/** Unambiguous alphabet — these codes get read down a phone and typed by hand.
 *  Dropped: O/0, I/1, L (an l or a 1 in the wrong font), U/V. 29 symbols. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const CODE_LENGTH = 8;

export function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * A short code a human types into the installer once. Rejection sampling, not
 * `% alphabet.length`: the modulo would quietly bias the low end of the
 * alphabet, since 256 is not a multiple of 30.
 */
export function generateEnrolmentCode(): string {
  const max = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const byte of crypto.randomBytes(CODE_LENGTH)) {
      if (byte >= max) continue;
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (out.length === CODE_LENGTH) break;
    }
  }
  return out;
}

/** The long-lived agent token. Never expires by design (§627). */
export function generateAgentToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Codes are typed by hand, so accept them however they arrive. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, '');
}

/** How long an enrolment code stays usable. Short: it is used within minutes. */
export const CODE_TTL_MINUTES = 15;
