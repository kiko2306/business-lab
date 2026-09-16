/**
 * Credential fan-out for apps that can't sit behind Authelia at all (§480):
 * when a dashboard user has access to one of these apps, their real
 * username/email/password gets pushed into that app's own account instead
 * of a per-app generated secret — the user's explicit choice, having been
 * told the tradeoff (that credential then also lives, hashed, in that app's
 * own database too).
 *
 * Keyed by service name in PROVISIONERS below; an app only becomes
 * grantable in Users & Roles (see `getGrantableAppOptions` in
 * userAppAccess.ts) once it has an entry here. `skipAutheliaProtection`
 * alone isn't enough — the remaining no-SSO apps (Kimai, Home Assistant,
 * Jellyfin) don't have a provisioner built yet; each is its own README
 * item.
 *
 * NocoDB's own org-user Meta API turned out to be plain OSS (confirmed
 * against upstream's `org-users.controller.ts`/`users.service.ts`, no
 * Business/Enterprise gate on this path) — `provisionNocodbUser` invites
 * through it, then sets the real password via the same reset-token flow a
 * human clicking the (never-sent, no SMTP configured) invite email would.
 *
 * ITFlow has no such API at all — `provisionItflowUser` signs in as the
 * ITFlow admin and drives its own `admin/users.php` add/edit forms,
 * because the one function that can correctly wrap its site-wide
 * credential-encryption key for a new/changed user (`encryptUserSpecificKey()`)
 * only works from a live logged-in session, the same session-only gap
 * `itflowAdminBootstrap.ts` already found on the admin's own password sync.
 *
 * DocuSeal also covers a later password change, not just first grant (§482):
 * `provisionDocusealTeamMember` falls back to setting the password directly
 * via `rails runner` in DocuSeal's own container when `createTeamUser` 422s
 * on a duplicate active email, since DocuSeal's own `UsersController#update`
 * has no way to do this over HTTP at all.
 *
 * Deliberately NOT wired into the recovery-mode / `recoverAdmin.ts` break-
 * glass paths (§482) — those exist specifically to work when the system is
 * already in a degraded, locked-out state, and adding an HTTP round-trip to
 * a third-party app's login form is exactly the kind of extra failure
 * surface that shouldn't sit on that path.
 *
 * `deprovisionNoSsoCredentials` (§493) is the other direction: when an
 * admin *revokes* one of these apps from Users & Roles, the account in
 * that app is disabled/locked, not deleted — each app's own best
 * equivalent (DocuSeal's own archive, ITFlow's real Disable action, a
 * scrambled unknown password for NocoDB, which has no disable flag at
 * all). Re-granting access re-provisions it (the create/update path
 * already un-archives DocuSeal and re-sets NocoDB/ITFlow's password), so
 * there's no separate "re-enable" entry point needed here.
 */

import logger from '../utils/logger';
import { disableDocusealTeamMember, provisionDocusealTeamMember } from './docusealTeamProvisioning';
import { disableItflowUser, provisionItflowUser } from './itflowUserProvisioning';
import { disableNocodbUser, provisionNocodbUser } from './nocodbUserProvisioning';

export interface NoSsoCredentialInput {
  email: string;
  password: string;
  displayName?: string;
}

type Provisioner = (input: NoSsoCredentialInput) => Promise<string>;
type Deprovisioner = (email: string) => Promise<string>;

const PROVISIONERS: Record<string, Provisioner> = {
  docuseal: provisionDocusealTeamMember,
  nocodb: provisionNocodbUser,
  itflow: provisionItflowUser,
};

const DEPROVISIONERS: Record<string, Deprovisioner> = {
  docuseal: disableDocusealTeamMember,
  nocodb: disableNocodbUser,
  itflow: disableItflowUser,
};

/** Apps that can accept a fanned-out credential today. */
export function getNoSsoCredentialAppNames(): string[] {
  return Object.keys(PROVISIONERS);
}

/**
 * Push `input`'s credentials into every one of `grantedApps` that has a
 * provisioner (apps with none are silently skipped — `grantedApps` may also
 * hold Authelia-gated app names, which never match here). Never throws: one
 * app failing doesn't stop the others.
 */
export async function fanOutNoSsoCredentials(grantedApps: string[], input: NoSsoCredentialInput): Promise<void> {
  for (const serviceName of grantedApps) {
    const provision = PROVISIONERS[serviceName];
    if (!provision) continue;
    try {
      const outcome = await provision(input);
      if (outcome === 'already-exists') {
        logger.warn(
          `No-SSO credential fan-out (${serviceName}) for ${input.email}: an account already exists there and the password update itself failed — it may now be out of sync.`
        );
      } else {
        logger.info(`No-SSO credential fan-out (${serviceName}) for ${input.email}: ${outcome}`);
      }
    } catch (error) {
      logger.error(`No-SSO credential fan-out (${serviceName}) failed for ${input.email}`, {
        error: (error as Error).message,
      });
    }
  }
}

/**
 * Lock `email`'s account in every one of `removedApps` that has a
 * deprovisioner. Same shape as `fanOutNoSsoCredentials` — never throws,
 * one app failing doesn't stop the others, apps with no deprovisioner
 * (or that were never actually granted) are silently skipped.
 */
export async function deprovisionNoSsoCredentials(removedApps: string[], email: string): Promise<void> {
  for (const serviceName of removedApps) {
    const deprovision = DEPROVISIONERS[serviceName];
    if (!deprovision) continue;
    try {
      const outcome = await deprovision(email);
      logger.info(`No-SSO credential deprovision (${serviceName}) for ${email}: ${outcome}`);
    } catch (error) {
      logger.error(`No-SSO credential deprovision (${serviceName}) failed for ${email}`, {
        error: (error as Error).message,
      });
    }
  }
}
