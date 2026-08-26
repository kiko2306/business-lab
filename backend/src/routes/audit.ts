import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { schemas, validateQuery } from '../middleware/validation';

const router = Router();

interface AuditLogRow {
  id: number;
  username: string | null;
  action: string;
  resource: string | null;
  result: string;
  created_at: string;
}

function parsePaging(value: unknown, fallback: number): number {
  const num = Number.parseInt(String(value), 10);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return num;
}

interface AuditFilterParams {
  action?: string;
  result?: string;
  startDate?: string;
  endDate?: string;
}

function buildFilters(params: AuditFilterParams): { whereSql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];

  const { action, result, startDate, endDate } = params;

  if (action) {
    values.push(action);
    clauses.push(`a.action = $${values.length}`);
  }
  if (result) {
    values.push(result);
    clauses.push(`a.result = $${values.length}`);
  }
  if (startDate) {
    values.push(startDate);
    clauses.push(`a.created_at >= $${values.length}::timestamptz`);
  }
  if (endDate) {
    values.push(endDate);
    clauses.push(`a.created_at <= $${values.length}::timestamptz`);
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

function toCsv(rows: AuditLogRow[]): string {
  const header = ['id', 'username', 'action', 'resource', 'result', 'created_at'];
  const lines = [header.join(',')];

  for (const row of rows) {
    const cols = [
      row.id,
      row.username ?? '',
      row.action ?? '',
      row.resource ?? '',
      row.result ?? '',
      new Date(row.created_at).toISOString(),
    ];

    lines.push(cols.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
  }

  return lines.join('\n');
}

router.get('/', validateQuery(schemas.auditQuery), async (req: Request, res: Response) => {
  const params = req.query as AuditFilterParams & { page?: string; pageSize?: string };
  const page = parsePaging(params.page, 1);
  const pageSize = Math.min(parsePaging(params.pageSize, 20), 100);
  const offset = (page - 1) * pageSize;
  const { whereSql, values } = buildFilters(params);

  try {
    const listQuery = `
      SELECT a.id, a.action, a.resource, a.result, a.created_at, u.username
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `;

    const countQuery = `SELECT COUNT(*)::int AS total FROM audit_logs a ${whereSql}`;

    const [listResult, countResult] = await Promise.all([
      query<AuditLogRow>(listQuery, [...values, pageSize, offset]),
      query<{ total: number }>(countQuery, values),
    ]);

    return res.json({
      items: listResult.rows,
      page,
      pageSize,
      total: countResult.rows[0]?.total ?? 0,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

router.get('/export.csv', validateQuery(schemas.auditQuery), async (req: Request, res: Response) => {
  const { whereSql, values } = buildFilters(req.query as AuditFilterParams);

  try {
    const limit = 100000;
    const result = await query<AuditLogRow>(
      `SELECT a.id, a.action, a.resource, a.result, a.created_at, u.username
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.created_at DESC
       LIMIT $${values.length + 1}`,
      [...values, limit]
    );

    const csv = toCsv(result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    return res.send(csv);
  } catch {
    return res.status(500).json({ error: 'Unable to export audit logs.' });
  }
});

export default router;
