import { describe, expect, it } from 'vitest';
import { schemas } from './validation';

// plan.md §790: a malformed invitation/unsubscribe token — reached by an
// anonymous visitor clicking a stale or truncated email link, no dashboard
// session — used to surface Joi's raw pattern-mismatch string instead of a
// plain-language message. Found live during an audit.
describe('public token schemas give a plain-language message on a bad token', () => {
  it('invitationToken', () => {
    const { error } = schemas.invitationToken.validate({ token: 'too-short' });
    expect(error?.details[0].message).toBe('This invitation link is no longer valid. Ask for a new one.');
  });

  it('subscriberToken', () => {
    const { error } = schemas.subscriberToken.validate({ token: 'too-short' });
    expect(error?.details[0].message).toBe('This link is invalid or has expired.');
  });
});
