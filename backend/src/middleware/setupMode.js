'use strict';

const { query } = require('../utils/database');

/**
 * Returns a middleware that checks whether the application has been set up.
 *
 * - On setup endpoints (`allowWhenSetupIncomplete = true`):
 *   Allow access only when no admin user exists.
 *   Return 403 once setup is complete.
 *
 * - On protected endpoints (`allowWhenSetupIncomplete = false`, the default):
 *   Return 503 when setup has not yet been completed so the client knows
 *   to redirect to the setup screen.
 */
function setupModeMiddleware(allowWhenSetupIncomplete = false) {
  return async (req, res, next) => {
    try {
      const result = await query(
        'SELECT COUNT(*) AS cnt FROM users WHERE is_setup_complete = TRUE',
        []
      );
      const setupComplete = parseInt(result.rows[0].cnt, 10) > 0;

      if (allowWhenSetupIncomplete) {
        // Setup endpoints
        if (setupComplete) {
          return res.status(403).json({ error: 'Setup is already complete' });
        }
        return next();
      }

      // Protected endpoints
      if (!setupComplete) {
        return res.status(503).json({
          error: 'Application not yet configured',
          setupRequired: true,
        });
      }
      return next();
    } catch (err) {
      console.error('setupMode middleware error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = setupModeMiddleware;
