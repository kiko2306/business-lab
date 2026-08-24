'use strict';

const { Router } = require('express');
const { query } = require('../utils/database');

const router = Router();

function parsePaging(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return num;
}

function buildFilters(params) {
  const clauses = [];
  const values = [];

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

function toCsv(rows) {
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

router.get('/', async (req, res) => {
  const page = parsePaging(req.query.page, 1);
  const pageSize = Math.min(parsePaging(req.query.pageSize, 20), 100);
  const offset = (page - 1) * pageSize;
  const { whereSql, values } = buildFilters(req.query);

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
      query(listQuery, [...values, pageSize, offset]),
      query(countQuery, values),
    ]);

    return res.json({
      items: listResult.rows,
      page,
      pageSize,
      total: countResult.rows[0]?.total ?? 0,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

router.get('/export.csv', async (req, res) => {
  const { whereSql, values } = buildFilters(req.query);

  try {
    const result = await query(
      `SELECT a.id, a.action, a.resource, a.result, a.created_at, u.username
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.created_at DESC`,
      values
    );

    const csv = toCsv(result.rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ error: 'Unable to export audit logs.' });
  }
});

module.exports = router;
