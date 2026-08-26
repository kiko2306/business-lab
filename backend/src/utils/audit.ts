import { query } from './database';

interface WriteAuditLogOptions {
  userId?: number | null;
  action: string;
  resource?: string | null;
  result?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog({
  userId = null,
  action,
  resource = null,
  result = 'success',
  metadata = {},
}: WriteAuditLogOptions): Promise<void> {
  await query(
    `INSERT INTO audit_logs (user_id, action, resource, result, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, resource, result, JSON.stringify(metadata ?? {})]
  ).catch(async (error: { code?: string }) => {
    if (error.code !== '42703') {
      throw error;
    }
    await query(
      'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
      [userId, action, resource, result]
    );
  });
}
