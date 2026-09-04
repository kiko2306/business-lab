/**
 * Named roles and the dashboard capabilities each one grants (§131.3 / plan.md
 * §149, reshaped in §152). The map is enforced — `requireCapability` gates the
 * routes and the frontend hides what an account can't reach.
 *
 * Three roles (`user_roles` join table; a user may hold several):
 *
 *  - `webmaster` — every capability, always. Created by `/setup`, restored by
 *    `./start.sh recover`. Never narrowed per account.
 *  - `admin` — every capability by default, but a webmaster can switch
 *    individual features off for one admin account via the `user_capabilities`
 *    grant table. **No grant rows means all-on** (a fresh admin is full); the
 *    users API refuses to leave an admin with an empty grant set.
 *  - `user` — no dashboard capability at all; the account exists only to be
 *    granted SSO app access (plan.md §151).
 *
 * The map is code, not data — same reasoning as the service registry: it
 * changes with a deploy, reviewed in a diff, never at runtime.
 */

export const ROLES = ['webmaster', 'admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'apps:control', // start / stop / restart a managed app
  'apps:config', // write a managed app's .env
  'apps:expose', // toggle a managed app's public exposure
  'exposure:settings', // Cloudflare token, tunnel/zone IDs, NPM credentials
  'backups:manage', // run / restore / schedule backups
  'settings:manage', // timezone, ntfy alerts, mailbox, backup destination
  'audit:view', // read the audit log
  'users:manage', // create / delete users, assign roles and features
  'system:update', // check for and apply a git pull + rebuild of the dashboard itself
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * The capabilities an account actually holds, from its roles and its
 * per-account grant rows:
 *
 *  - holds `webmaster` → every capability, `grants` ignored;
 *  - else holds `admin` → the granted capabilities, or **every** capability
 *    when there are no grant rows (a fresh admin is full — a webmaster narrows
 *    it afterwards);
 *  - otherwise → none.
 *
 * Always returned in the canonical `CAPABILITIES` order.
 */
export function effectiveCapabilities(
  roles: readonly string[],
  grants: readonly string[] = []
): Capability[] {
  if (roles.includes('webmaster')) {
    return [...CAPABILITIES];
  }
  if (roles.includes('admin')) {
    const granted = grants.filter(isCapability);
    const allowed = granted.length ? new Set<Capability>(granted) : new Set<Capability>(CAPABILITIES);
    return CAPABILITIES.filter((capability) => allowed.has(capability));
  }
  return [];
}

/** Whether an account with these roles + grant rows holds `capability`. */
export function hasCapability(
  roles: readonly string[],
  grants: readonly string[],
  capability: Capability
): boolean {
  return effectiveCapabilities(roles, grants).includes(capability);
}
