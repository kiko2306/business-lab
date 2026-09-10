/**
 * Extra `docker compose up` env for apps that seed their own first/admin
 * account straight from environment variables on boot — no REST bootstrap
 * needed (unlike DocuSeal §341). NocoDB takes `NC_ADMIN_EMAIL` +
 * `NC_ADMIN_PASSWORD` and (re-)provisions its super admin from them every
 * start; Kimai's entrypoint runs `kimai:user:create admin` from
 * `ADMINMAIL`/`ADMINPASS` every start (no-ops once the user exists).
 *
 * In both cases the password is the app's own generated `*_ADMIN_PASSWORD`
 * (in its `.env`, so the compose file already wires it); this only has to
 * supply the email, which is the Authelia admin's — so the operator signs in
 * with a familiar identity. Injected the same way the mail/exposure overrides
 * are: merged over the shell environment for the `up`, never persisted. No-op
 * for every other service, and a no-op for these until there is an Authelia
 * admin email to use.
 */

import { getAutheliaAdminUser } from './autheliaUsers';

const ADMIN_EMAIL_ENV_KEY: Record<string, string> = {
  nocodb: 'NOCODB_ADMIN_EMAIL',
  kimai: 'KIMAI_ADMIN_EMAIL',
};

export async function buildAdminSeedEnvOverrides(serviceName: string): Promise<Record<string, string>> {
  const envKey = ADMIN_EMAIL_ENV_KEY[serviceName];
  if (!envKey) {
    return {};
  }
  const email = getAutheliaAdminUser()?.email?.trim();
  if (!email) {
    return {};
  }
  return { [envKey]: email };
}
