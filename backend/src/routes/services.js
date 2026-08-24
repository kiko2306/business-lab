/**
 * Services API routes
 * Handles service start, stop, and status endpoints.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');
const executor = require('../services/executor');
const status = require('../services/status');
const { createStreamTicket } = require('../services/realtime');
const { isValidServiceName } = require('../config/services');
const { schemas, validateParams } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many service requests, please try again later.' },
});

function validateServiceAllowlist(req, res, next) {
  if (!isValidServiceName(req.params.name)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }
  return next();
}

/**
 * GET /api/services/status
 * Get status of all services
 */
router.get('/status', serviceLimiter, auth, async (req, res) => {
  try {
    const serviceStatus = await status.getAllServiceStatus();
    res.json(serviceStatus);
  } catch (error) {
    logger.error('Failed to get service status', {
      error: error.message,
      userId: req.user.id,
    });
    res.status(500).json({
      error: 'Failed to retrieve service status',
      message: error.message,
    });
  }
});

router.post('/stream-ticket', serviceLimiter, auth, (req, res) => {
  const ticket = createStreamTicket(req.user.id);
  res.json({ ticket, expiresInSeconds: 60 });
});

/**
 * POST /api/services/:name/start
 * Start a service
 */
router.post('/:name/start', serviceLimiter, auth, validateParams(schemas.serviceNameParam), validateServiceAllowlist, async (req, res) => {
  const serviceName = req.params.name;
  const userId = req.user.id;

  try {
    logger.info(`Service start request: ${serviceName}`, { userId, service: serviceName });

    const result = await executor.startService(serviceName, userId);
    res.json(result);
  } catch (error) {
    logger.error(`Service start failed: ${serviceName}`, {
      userId,
      error: error.message,
    });

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to start service',
      service: serviceName,
      message: error.message,
      details: error.details,
    });
  }
});

/**
 * POST /api/services/:name/stop
 * Stop a service
 */
router.post('/:name/stop', serviceLimiter, auth, validateParams(schemas.serviceNameParam), validateServiceAllowlist, async (req, res) => {
  const serviceName = req.params.name;
  const userId = req.user.id;

  try {
    logger.info(`Service stop request: ${serviceName}`, { userId, service: serviceName });

    const result = await executor.stopService(serviceName, userId);
    res.json(result);
  } catch (error) {
    logger.error(`Service stop failed: ${serviceName}`, {
      userId,
      error: error.message,
    });

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: 'Failed to stop service',
      service: serviceName,
      message: error.message,
      details: error.details,
    });
  }
});

module.exports = router;
