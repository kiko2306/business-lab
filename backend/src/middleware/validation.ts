import { NextFunction, Request, Response } from 'express';
import Joi, { ObjectSchema, ValidationError } from 'joi';

const validationOptions = {
  abortEarly: false,
  allowUnknown: false,
  convert: true,
};

const usernameSchema = Joi.string()
  .trim()
  .min(3)
  .max(64)
  .pattern(/^[a-zA-Z0-9_.@-]+$/);

const passwordSchema = Joi.string().min(8).max(128);
const serviceNameSchema = Joi.string().trim().min(1).max(64).pattern(/^[a-z0-9-]+$/);
const backupNameSchema = Joi.string().trim().max(255).pattern(/^[a-zA-Z0-9._-]+$/);
const domainSchema = Joi.string()
  .trim()
  .min(1)
  .max(255)
  .pattern(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/);

export const schemas = {
  authSetup: Joi.object({
    username: usernameSchema.required(),
    password: passwordSchema.required(),
  }),
  authLogin: Joi.object({
    username: usernameSchema.required(),
    password: Joi.string().min(1).max(128).required(),
  }),
  authLogout: Joi.object({
    refreshToken: Joi.string().max(2048).allow('', null).optional(),
  }),
  authRefresh: Joi.object({
    refreshToken: Joi.string().max(2048).required(),
  }),
  serviceNameParam: Joi.object({
    name: serviceNameSchema.required(),
  }),
  cloudflareTokenUpdate: Joi.object({
    token: Joi.string().trim().min(20).max(4096).required(),
  }),
  cloudflareTokenTest: Joi.object({
    token: Joi.string().trim().min(20).max(4096).allow('').optional(),
  }),
  backupRestore: Joi.object({
    fileName: backupNameSchema.required(),
  }),
  backupDownloadParams: Joi.object({
    fileName: backupNameSchema.required(),
  }),
  backupScheduleUpdate: Joi.object({
    enabled: Joi.boolean().required(),
    frequency: Joi.string().valid('daily', 'weekly').required(),
    retentionCount: Joi.number().integer().min(1).max(365).required(),
  }),
  exposureGlobalSettings: Joi.object({
    baseDomain: domainSchema.required(),
    npmApiUrl: Joi.string().trim().uri({ scheme: ['http', 'https'] }).max(500).required(),
    npmEmail: Joi.string().trim().email().max(255).required(),
    // Optional: omit to keep the previously saved password unchanged.
    npmPassword: Joi.string().min(1).max(255).optional(),
    cloudflareAccountId: Joi.string().trim().alphanum().length(32).required(),
    cloudflareZoneId: Joi.string().trim().alphanum().length(32).required(),
    cloudflareTunnelId: Joi.string().trim().min(1).max(255).required(),
  }),
  serviceExposureUpdate: Joi.object({
    enabled: Joi.boolean().required(),
  }),
  serviceEnvUpdate: Joi.object({
    values: Joi.object().pattern(/^[A-Z][A-Z0-9_]*$/, Joi.string().allow('').max(2000)).required(),
  }),
  healthThresholds: Joi.object({
    diskPercent: Joi.number().min(1).max(100).required(),
    memoryPercent: Joi.number().min(1).max(100).required(),
    loadPerCpu: Joi.number().min(0).max(100).required(),
  }),
  recoveryEnable: Joi.object({
    confirm: Joi.string().valid('ENABLE_RECOVERY_MODE').required(),
  }),
  userCreate: Joi.object({
    username: usernameSchema.required(),
    password: passwordSchema.required(),
  }),
  userIdParam: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
  userPasswordUpdate: Joi.object({
    password: passwordSchema.required(),
  }),
  recoveryResetAdminPassword: Joi.object({
    username: usernameSchema.required(),
    password: passwordSchema.required(),
  }),
  auditQuery: Joi.object({
    page: Joi.number().integer().min(1).max(100000).optional(),
    pageSize: Joi.number().integer().min(1).max(100).optional(),
    action: Joi.string().trim().min(1).max(64).pattern(/^[a-zA-Z0-9:_-]+$/).optional(),
    result: Joi.string().trim().min(1).max(64).pattern(/^[a-zA-Z0-9:_-]+$/).optional(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
  }),
};

type ValidationSource = 'body' | 'params' | 'query';

function validationError(res: Response, error: ValidationError) {
  return res.status(422).json({
    error: 'Invalid request input',
    details: error.details.map((detail) => detail.message),
  });
}

function validate(schema: ObjectSchema, source: ValidationSource) {
  return (req: Request, res: Response, next: NextFunction) => {
    const payload = (req[source] as Record<string, unknown>) || {};
    const { error, value } = schema.validate(payload, validationOptions);
    if (error) {
      return validationError(res, error);
    }
    (req as unknown as Record<ValidationSource, unknown>)[source] = value;
    return next();
  };
}

export const validateBody = (schema: ObjectSchema) => validate(schema, 'body');
export const validateParams = (schema: ObjectSchema) => validate(schema, 'params');
export const validateQuery = (schema: ObjectSchema) => validate(schema, 'query');
