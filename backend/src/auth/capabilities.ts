/**
 * Named roles and the dashboard capabilities each one grants (§131.3 / plan.md
 * §149). Roles were removed once (`51387f0`) as "unused"; they are back because
 * this map is now enforced — `requireCapability` gates the routes, and the
 * frontend hides what a role can't reach.
 *
 * A user can hold several roles (`user_roles` join table); their effective
 * capabilities are the union. The map is code, not data — same reasoning as
 * the service registry: it changes with a deploy, reviewed in a diff, never at
 * runtime.
 */

export const ROLES = ['owner', 'it_admin', 'webmaster', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const CAPABILITIES = [
  'apps:control', // start / stop / restart a managed app
  'apps:config', // write a managed app's .env
  'apps:expose', // toggle a managed app's public exposure
  'exposure:settings', // Cloudflare token, tunnel/zone IDs, NPM credentials
  'backups:manage', // run / restore / schedule backups
  'settings:manage', // timezone, ntfy alerts, mailbox, backup destination
  'audit:view', // read the audit log
  'users:manage', // create / delete users, assign roles
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * The IT admin runs and maintains the app stack; the webmaster owns the
 * Cloudflare side and nothing else; the owner is both plus user management;
 * `user` is a dashboard-less account that exists only to be granted SSO app
 * access in a later slice.
 */
const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: CAPABILITIES,
  it_admin: [
    'apps:control',
    'apps:config',
    'apps:expose',
    'backups:manage',
    'settings:manage',
    'audit:view',
  ],
  webmaster: ['exposure:settings'],
  user: [],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Effective capabilities for a set of roles — the union, deduplicated. */
export function capabilitiesFor(roles: readonly string[]): Capability[] {
  const out = new Set<Capability>();
  for (const role of roles) {
    if (isRole(role)) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        out.add(capability);
      }
    }
  }
  return CAPABILITIES.filter((capability) => out.has(capability));
}

export function roleHasCapability(roles: readonly string[], capability: Capability): boolean {
  return capabilitiesFor(roles).includes(capability);
}
