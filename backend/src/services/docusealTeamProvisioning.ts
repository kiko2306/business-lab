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
 * `createTeamUser` 422s on a duplicate active email rather than updating it
 * — DocuSeal's own `POST /users` form has no update mode. When that happens,
 * this falls back to `setDocusealUserPassword` (docusealDb.ts), which sets
 * the password directly via `rails runner` in DocuSeal's own container
 * (§482) — the one path that actually can update an existing account,
 * since `UsersController#update` itself always strips `:password` from an
 * admin's edit of another user.
 *
 * `disableDocusealTeamMember` (§493): revoking dashboard access archives
 * the account rather than deleting it, reusing `docusealDb.ts`'s
 * `archiveDocusealUser` — the same rails-runner container as the password
 * path, no admin sign-in needed since it goes through the model directly.
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
import { archiveDocusealUser, setDocusealUserPassword } from './docusealDb';

export type ProvisionDocusealTeamMemberResult =
  | 'created'
  | 'updated'
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
    return result;
  }
  if (result === 'already-exists') {
    const updateResult = await setDocusealUserPassword(input.email, input.password);
    if (updateResult === 'updated') {
      logger.info(`Updated the existing DocuSeal team account's password for ${input.email}`);
      return 'updated';
    }
    logger.warn(`DocuSeal already has an account for ${input.email} but its password could not be updated`, {
      updateResult,
    });
    return 'already-exists';
  }
  logger.error(`DocuSeal team-member provisioning failed for ${input.email}`);
  return result;
}

export type DisableDocusealTeamMemberResult = 'disabled' | 'not-found' | 'failed';

export async function disableDocusealTeamMember(email: string): Promise<DisableDocusealTeamMemberResult> {
  const result = await archiveDocusealUser(email);
  if (result === 'archived') {
    logger.info(`Archived the DocuSeal team account for ${email}`);
    return 'disabled';
  }
  if (result === 'not-found') {
    logger.warn(`No DocuSeal account found for ${email} to archive`);
    return 'not-found';
  }
  logger.error(`Failed to archive the DocuSeal team account for ${email}`);
  return 'failed';
}
