import { NextFunction, Request, Response } from 'express';
import Joi, { ObjectSchema, ValidationError } from 'joi';
import { CAPABILITIES, ROLES } from '../auth/capabilities';

// At least one role, each a known name, no duplicates (plan.md §149).
const rolesSchema = Joi.array()
  .items(Joi.string().valid(...ROLES))
  .min(1)
  .unique()
  .required();

// A feature-grant set for an admin account (plan.md §152): known capability
// names, no duplicates. Optional and possibly empty on create (empty = the
// all-on default); required and non-empty when replacing an admin's grants.
const capabilitiesSchema = Joi.array()
  .items(Joi.string().valid(...CAPABILITIES))
  .unique();

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
const emailSchema = Joi.string().trim().email().max(255);
const serviceNameSchema = Joi.string().trim().min(1).max(64).pattern(/^[a-z0-9-]+$/);

// The per-user SSO app-access list (plan.md §151): known managed-app names,
// deduplicated. May be empty — that is "no SSO app access". The route checks
// each name against the currently grantable apps.
const appAccessSchema = Joi.array().items(serviceNameSchema).unique();
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
  // Second step of a 2FA login: the hand-off token from /auth/login plus a
  // 6-digit TOTP code or a recovery code (the handler tells them apart).
  authLoginTotp: Joi.object({
    mfaToken: Joi.string().max(2048).required(),
    code: Joi.string().trim().min(6).max(32).required(),
  }),
  // Activating TOTP: a 6-digit code from the authenticator app.
  totpActivate: Joi.object({
    code: Joi.string().trim().pattern(/^\d{6}$/).required(),
  }),
  // Disabling TOTP: re-verify with a current 6-digit code OR the account
  // password. Exactly one is required.
  totpDisable: Joi.object({
    code: Joi.string().trim().pattern(/^\d{6}$/),
    password: Joi.string().min(1).max(128),
  }).xor('code', 'password'),
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
  backupTarget: Joi.object({
    kind: Joi.string().valid('disk', 'smb', 'nfs', 'googledrive').required(),
    path: Joi.string().trim().max(500).allow('').optional(),
    server: Joi.string().trim().max(255).allow('').optional(),
    share: Joi.string().trim().max(500).allow('').optional(),
    username: Joi.string().trim().max(255).allow('').optional(),
    // Optional: omit to keep the stored password unchanged.
    password: Joi.string().max(255).optional(),
    options: Joi.string().trim().max(500).allow('').optional(),
    // Google Drive. authId is a long-lived refresh token — optional so a save
    // that leaves the field blank keeps the stored one.
    authId: Joi.string().trim().max(4096).optional(),
    folder: Joi.string().trim().max(255).allow('').optional(),
  }),

  mailSettings: Joi.object({
    smtpHost: Joi.string().trim().hostname().max(255).required(),
    smtpPort: Joi.number().integer().min(1).max(65535).required(),
    smtpUser: Joi.string().trim().max(255).allow('').required(),
    // Optional: omit to keep the previously saved password unchanged, same
    // convention as npmPassword above.
    smtpPassword: Joi.string().min(1).max(255).optional(),
    smtpEncryption: Joi.string().valid('tls', 'ssl', 'none').required(),
    fromAddress: Joi.string().trim().email().max(255).required(),
    fromName: Joi.string().trim().max(255).allow('').optional(),
    // Receiving is optional in full: an empty imapHost clears it.
    imapHost: Joi.string().trim().hostname().max(255).allow('').optional(),
    imapPort: Joi.number().integer().min(1).max(65535).allow(null).optional(),
    imapUser: Joi.string().trim().max(255).allow('').optional(),
    imapPassword: Joi.string().min(1).max(255).optional(),
    imapEncryption: Joi.string().valid('tls', 'ssl', 'none').optional(),
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
    autheliaProtected: Joi.boolean().optional(),
  }),
  serviceEnvUpdate: Joi.object({
    values: Joi.object().pattern(/^[A-Z][A-Z0-9_]*$/, Joi.string().allow('').max(2000)).required(),
  }),
  autheliaAdminUserUpdate: Joi.object({
    username: Joi.string().trim().min(1).max(64).pattern(/^[a-zA-Z0-9_.-]+$/).required(),
    displayName: Joi.string().trim().min(1).max(128).required(),
    email: Joi.string().trim().email().max(255).required(),
    // Optional: omit or leave blank to keep the previously saved password.
    password: passwordSchema.allow('').optional(),
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
    // A valid address if given. The create form (slice 2b) makes it a required
    // field; the API stays lenient so a missing email just means "set it later
    // on the Access editor" rather than a hard failure — the column is
    // nullable and Authelia sync (2c) skips an account with no email.
    email: emailSchema.optional(),
    roles: rolesSchema,
    // Seeds an admin's feature grants; ignored for a webmaster/user. Omitted
    // or empty leaves an admin at the all-on default.
    capabilities: capabilitiesSchema.optional(),
    // SSO app-access list; omitted means none.
    appAccess: appAccessSchema.optional(),
  }),
  userIdParam: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
  userPasswordUpdate: Joi.object({
    password: passwordSchema.required(),
  }),
  userRolesUpdate: Joi.object({
    roles: rolesSchema,
  }),
  // Replace an admin account's feature grants (plan.md §152). At least one —
  // an admin with no features left is a role with nothing to do.
  userCapabilitiesUpdate: Joi.object({
    capabilities: capabilitiesSchema.min(1).required(),
  }),
  // Replace an account's email and SSO app-access list (plan.md §151). Both
  // keys required; appAccess may be an empty array ("no SSO app access").
  userAccessUpdate: Joi.object({
    email: emailSchema.required(),
    appAccess: appAccessSchema.required(),
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
