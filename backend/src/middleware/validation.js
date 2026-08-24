'use strict';

const Joi = require('joi');

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

const schemas = {
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
  healthThresholds: Joi.object({
    diskPercent: Joi.number().min(1).max(100).required(),
    memoryPercent: Joi.number().min(1).max(100).required(),
    loadPerCpu: Joi.number().min(0).max(100).required(),
  }),
  recoveryEnable: Joi.object({
    confirm: Joi.string().valid('ENABLE_RECOVERY_MODE').required(),
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

function validationError(res, error) {
  return res.status(422).json({
    error: 'Invalid request input',
    details: error.details.map((detail) => detail.message),
  });
}

function validate(schema, source) {
  return (req, res, next) => {
    const payload = req[source] || {};
    const { error, value } = schema.validate(payload, validationOptions);
    if (error) {
      return validationError(res, error);
    }
    req[source] = value;
    return next();
  };
}

module.exports = {
  schemas,
  validateBody: (schema) => validate(schema, 'body'),
  validateParams: (schema) => validate(schema, 'params'),
  validateQuery: (schema) => validate(schema, 'query'),
};
