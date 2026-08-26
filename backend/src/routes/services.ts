/**
 * Services API routes
 * Handles service start, stop, and status endpoints.
 */

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import auth from '../middleware/auth';
import * as executor from '../services/executor';
import * as status from '../services/status';
import { createStreamTicket } from '../services/realtime';
import { isValidServiceName } from '../config/services';
import { schemas, validateParams, validateBody } from '../middleware/validation';
import { getServiceExposureRow, upsertServiceExposureConfig } from '../services/exposure';
import logger from '../utils/logger';
import { HttpError } from '../types';

const router = Router();

const serviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many service requests, please try again later.' },
});

function validateServiceAllowlist(req: Request, res: Response, next: NextFunction) {
  if (!isValidServiceName(req.params.name)) {
    return res.status(400).json({ error: 'Invalid service name' });
  }
  return next();
}

/**
 * GET /api/services/status
 * Get status of all services
 */
router.get('/status', serviceLimiter, auth, async (req: Request, res: Response) => {
  try {
    const serviceStatus = await status.getAllServiceStatus();
    res.json(serviceStatus);
  } catch (error) {
    logger.error('Failed to get service status', {
      error: (error as Error).message,
      userId: req.user?.id,
    });
    res.status(500).json({
      error: 'Failed to retrieve service status',
      message: (error as Error).message,
    });
  }
});

router.post('/stream-ticket', serviceLimiter, auth, (req: Request, res: Response) => {
  const ticket = createStreamTicket(req.user!.id);
  res.json({ ticket, expiresInSeconds: 60 });
});

/**
 * POST /api/services/:name/start
 * Start a service
 */
router.post(
  '/:name/start',
  serviceLimiter,
  auth,
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      logger.info(`Service start request: ${serviceName}`, { userId, service: serviceName });

      const result = await executor.startService(serviceName, userId);
      res.json(result);
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Service start failed: ${serviceName}`, {
        userId,
        error: httpError.message,
      });

      const statusCode = httpError.statusCode || 500;
      res.status(statusCode).json({
        error: 'Failed to start service',
        service: serviceName,
        message: httpError.message,
        details: httpError.details,
      });
    }
  }
);

/**
 * POST /api/services/:name/stop
 * Stop a service
 */
router.post(
  '/:name/stop',
  serviceLimiter,
  auth,
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    const serviceName = req.params.name;
    const userId = req.user!.id;

    try {
      logger.info(`Service stop request: ${serviceName}`, { userId, service: serviceName });

      const result = await executor.stopService(serviceName, userId);
      res.json(result);
    } catch (error) {
      const httpError = error as HttpError;
      logger.error(`Service stop failed: ${serviceName}`, {
        userId,
        error: httpError.message,
      });

      const statusCode = httpError.statusCode || 500;
      res.status(statusCode).json({
        error: 'Failed to stop service',
        service: serviceName,
        message: httpError.message,
        details: httpError.details,
      });
    }
  }
);

/**
 * GET /api/services/:name/exposure
 * Read public exposure provisioning config and status for a service
 */
router.get(
  '/:name/exposure',
  auth,
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  async (req: Request, res: Response) => {
    try {
      const row = await getServiceExposureRow(req.params.name);
      if (!row) {
        return res.json({
          enabled: false,
          hostname: null,
          upstreamScheme: 'http',
          upstreamHost: null,
          upstreamPort: null,
          websocket: false,
          status: 'not_provisioned',
          lastError: null,
        });
      }

      return res.json({
        enabled: row.enabled,
        hostname: row.hostname,
        upstreamScheme: row.upstream_scheme,
        upstreamHost: row.upstream_host,
        upstreamPort: row.upstream_port,
        websocket: row.websocket,
        status: row.status,
        lastError: row.last_error,
      });
    } catch (error) {
      logger.error(`Failed to load exposure config: ${req.params.name}`, { error: (error as Error).message });
      return res.status(500).json({ error: 'Unable to load exposure configuration.' });
    }
  }
);

/**
 * PUT /api/services/:name/exposure
 * Configure public exposure provisioning for a service. Opt-in per service;
 * provisioning itself happens on the next successful service start.
 */
router.put(
  '/:name/exposure',
  auth,
  validateParams(schemas.serviceNameParam),
  validateServiceAllowlist,
  validateBody(schemas.serviceExposureUpdate),
  async (req: Request, res: Response) => {
    try {
      const row = await upsertServiceExposureConfig(req.params.name, req.body);
      return res.json({
        message: 'Exposure configuration saved. It will be applied on the next service start.',
        enabled: row.enabled,
        hostname: row.hostname,
      });
    } catch (error) {
      logger.error(`Failed to save exposure config: ${req.params.name}`, { error: (error as Error).message });
      return res.status(500).json({ error: 'Unable to save exposure configuration.' });
    }
  }
);

export default router;
