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
 * alone isn't enough — most of the no-SSO apps (ITFlow, Kimai, Home
 * Assistant, Jellyfin) don't have a provisioner built yet; each is its own
 * README item.
 *
 * NocoDB's own org-user Meta API turned out to be plain OSS (confirmed
 * against upstream's `org-users.controller.ts`/`users.service.ts`, no
 * Business/Enterprise gate on this path) — `provisionNocodbUser` invites
 * through it, then sets the real password via the same reset-token flow a
 * human clicking the (never-sent, no SMTP configured) invite email would.
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
 */

import logger from '../utils/logger';
import { provisionDocusealTeamMember } from './docusealTeamProvisioning';
import { provisionNocodbUser } from './nocodbUserProvisioning';

export interface NoSsoCredentialInput {
  email: string;
  password: string;
  displayName?: string;
}

type Provisioner = (input: NoSsoCredentialInput) => Promise<string>;

const PROVISIONERS: Record<string, Provisioner> = {
  docuseal: provisionDocusealTeamMember,
  nocodb: provisionNocodbUser,
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
