/**
 * Create a real DocuSeal team-member account for a dashboard user, matching
 * their own email/password rather than a per-app generated secret (§480 —
 * the user's explicit choice, accepting that the credential then also lives,
 * hashed, in DocuSeal's own database).
 *
 * Signs in as the existing DocuSeal admin (the account docusealAdminBootstrap.ts
 * keeps synced to the Authelia admin) and drives DocuSeal's own "invite a team
 * member" form (`POST /users`) with the target user's real credentials — no
 * confirmation email required (§475: no `:confirmable` module on the User
 * model), so the account is usable immediately, not pending a click.
 *
 * Not yet wired to anything. This is the DocuSeal-specific slice of §480's
 * credential fan-out; the core mechanism — extending `user_app_access` to
 * include no-SSO apps, and hooking the six plaintext-password call sites —
 * is a separate, not-yet-built README item. This module only proves
 * DocuSeal's own side works. It also only covers *creating* an account:
 * re-running it for someone who already has one (e.g. after a later
 * password change) needs an update path this doesn't have yet — DocuSeal's
 * `POST /users` 422s on a duplicate active email rather than updating it,
 * and finding that person's DocuSeal user id to PATCH instead means parsing
 * the `/settings/users` listing, which nothing here does.
 */

import logger from '../utils/logger';
import { readAppEnvValue } from './appEnv';
import {
  DOCUSEAL_ADMIN_EMAIL_KEY,
  DOCUSEAL_ADMIN_PASSWORD_KEY,
  DOCUSEAL_SERVICE,
  resolveDocusealBaseUrl,
  splitName,
} from './docusealAdminBootstrap';
import { createTeamUser, signIn } from './docusealClient';

export type ProvisionDocusealTeamMemberResult =
  | 'created'
  | 'already-exists'
  | 'failed'
  | 'admin-not-configured'
  | 'admin-sign-in-failed';

export interface DocusealTeamMemberInput {
  email: string;
  password: string;
  displayName?: string;
}

export async function provisionDocusealTeamMember(
  input: DocusealTeamMemberInput
): Promise<ProvisionDocusealTeamMemberResult> {
  const adminEmail = readAppEnvValue(DOCUSEAL_SERVICE, DOCUSEAL_ADMIN_EMAIL_KEY);
  const adminPassword = readAppEnvValue(DOCUSEAL_SERVICE, DOCUSEAL_ADMIN_PASSWORD_KEY);
  if (!adminEmail || !adminPassword) {
    logger.warn('DocuSeal team-member provisioning skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }

  const baseUrl = await resolveDocusealBaseUrl();
  const signInResult = await signIn(baseUrl, adminEmail, adminPassword);
  if (signInResult.state !== 'signed-in') {
    logger.warn(`DocuSeal team-member provisioning skipped: could not sign in as ${adminEmail}`);
    return 'admin-sign-in-failed';
  }

  const { firstName, lastName } = splitName(input.displayName);
  const result = await createTeamUser(baseUrl, {
    cookie: signInResult.cookie,
    email: input.email,
    password: input.password,
    firstName,
    lastName,
  });

  if (result === 'created') {
    logger.info(`Created a DocuSeal team account for ${input.email}`);
  } else if (result === 'already-exists') {
    logger.info(`DocuSeal already has an account for ${input.email}`);
  } else {
    logger.error(`DocuSeal team-member provisioning failed for ${input.email}`);
  }
  return result;
}
