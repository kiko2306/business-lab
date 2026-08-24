'use strict';

const { query } = require('./database');

async function writeAuditLog({ userId = null, action, resource = null, result = 'success', metadata = {} }) {
  await query(
    `INSERT INTO audit_logs (user_id, action, resource, result, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, resource, result, JSON.stringify(metadata ?? {})]
  ).catch(async (error) => {
    if (error.code !== '42703') {
      throw error;
    }
    await query(
      'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
      [userId, action, resource, result]
    );
  });
}

module.exports = {
  writeAuditLog,
};
