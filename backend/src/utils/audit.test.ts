import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./database', () => db);
const log = vi.hoisted(() => ({ default: { error: vi.fn(), info: vi.fn() } }));
vi.mock('./logger', () => log);

import { purgeDeadRefreshTokens, purgeOldAuditLogs, writeAuditLog } from './audit';

describe('purgeOldAuditLogs', () => {
  it('deletes rows older than 30 days and reports the count removed', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 3 });

    const deleted = await purgeOldAuditLogs();

    expect(deleted).toBe(3);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM audit_logs WHERE created_at < NOW\(\) - INTERVAL '30 days'/);
  });
});

describe('writeAuditLog', () => {
  // Callers no longer guard it: a throw here would 500 a request whose action
  // (a login, a service start) had already taken effect.
  it('never throws when the insert fails, and logs the failure instead', async () => {
    db.query.mockRejectedValueOnce(new Error('connection refused'));

    await expect(writeAuditLog({ action: 'login', resource: 'auth' })).resolves.toBeUndefined();

    expect(log.default.error).toHaveBeenCalledWith(
      'Audit log write failed',
      expect.objectContaining({ action: 'login', error: 'connection refused' })
    );
  });
});

describe('purgeDeadRefreshTokens', () => {
  // Only rows /auth/refresh would already refuse: expired or revoked.
  it('deletes expired or revoked refresh tokens and reports the count', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 261 });

    expect(await purgeDeadRefreshTokens()).toBe(261);
    expect(db.query.mock.calls.at(-1)?.[0]).toBe('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked');
  });
});
