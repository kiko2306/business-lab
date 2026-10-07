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

describe('auditQuery action filter', () => {
  // Real audit actions are dotted (critical-service.probe-failed); a pattern without '.' made
  // filtering for them 422 in the Audit logs page.
  it('accepts a dotted action', () => {
    const { error } = schemas.auditQuery.validate({ action: 'critical-service.probe-failed' });
    expect(error).toBeUndefined();
  });

  it('still rejects spaces and quotes', () => {
    expect(schemas.auditQuery.validate({ action: "a b" }).error).toBeDefined();
    expect(schemas.auditQuery.validate({ action: "a'b" }).error).toBeDefined();
  });
});
