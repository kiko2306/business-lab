/**
 * Extra `docker compose up` env for apps that seed their own first/admin
 * account straight from environment variables on boot — no REST bootstrap
 * needed (unlike DocuSeal §341). Currently just NocoDB, which takes
 * `NC_ADMIN_EMAIL` + `NC_ADMIN_PASSWORD` and (re-)provisions its super admin
 * from them every start.
 *
 * The password is NocoDB's own generated `NOCODB_ADMIN_PASSWORD` (in its
 * `.env`, so the compose file already wires it); this only has to supply the
 * email, which is the Authelia admin's — so the operator signs in with a
 * familiar identity. Injected the same way the mail/exposure overrides are:
 * merged over the shell environment for the `up`, never persisted. No-op for
 * every other service, and a no-op for NocoDB too until there is an Authelia
 * admin email to use.
 */

import { getAutheliaAdminUser } from './autheliaUsers';

export async function buildAdminSeedEnvOverrides(serviceName: string): Promise<Record<string, string>> {
  if (serviceName !== 'nocodb') {
    return {};
  }
  const email = getAutheliaAdminUser()?.email?.trim();
  if (!email) {
    return {};
  }
  return { NOCODB_ADMIN_EMAIL: email };
}
