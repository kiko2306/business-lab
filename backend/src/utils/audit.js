'use strict';

const { query } = require('./database');

async function writeAuditLog({ userId = null, action, resource = null, result = 'success' }) {
  await query(
    'INSERT INTO audit_logs (user_id, action, resource, result) VALUES ($1, $2, $3, $4)',
    [userId, action, resource, result]
  );
}

module.exports = {
  writeAuditLog,
};
