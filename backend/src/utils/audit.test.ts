import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./database', () => db);

import { purgeOldAuditLogs } from './audit';

describe('purgeOldAuditLogs', () => {
  it('deletes rows older than 30 days and reports the count removed', async () => {
    db.query.mockResolvedValueOnce({ rowCount: 3 });

    const deleted = await purgeOldAuditLogs();

    expect(deleted).toBe(3);
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM audit_logs WHERE created_at < NOW\(\) - INTERVAL '30 days'/);
  });
});
