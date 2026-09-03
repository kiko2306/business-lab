import { Role } from './models';

/**
 * Frontend mirror of `backend/src/auth/capabilities.ts` (plan.md §149, §152).
 *
 * Roles are `webmaster` (every capability, always), `admin` (every capability
 * by default, but a webmaster can switch features off per account) and `user`
 * (none). The role→capability constant here is only an *optimistic* gate so
 * the nav renders synchronously with no blank frame; the real authority is the
 * effective `capabilities` array the backend puts on the session
 * (`AuthService` prefers it when present). For an `admin` the constant says
 * "all" and the backend narrows it — drift only ever shows a control the API
 * then refuses.
 */

export type Capability =
  | 'apps:control'
  | 'apps:config'
  | 'apps:expose'
  | 'exposure:settings'
  | 'backups:manage'
  | 'settings:manage'
  | 'audit:view'
  | 'users:manage';

export const ALL_CAPABILITIES: Capability[] = [
  'apps:control',
  'apps:config',
  'apps:expose',
  'exposure:settings',
  'backups:manage',
  'settings:manage',
  'audit:view',
  'users:manage',
];

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  webmaster: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES,
  user: [],
  // Legacy names — a session persisted before §152 still carries these until
  // its access token next refreshes. Remove a release after §152 ships.
  owner: ALL_CAPABILITIES,
  it_admin: ['apps:control', 'apps:config', 'apps:expose', 'backups:manage', 'settings:manage', 'audit:view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  webmaster: 'Webmaster',
  admin: 'Admin',
  user: 'SSO user',
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  'apps:control': 'Start / stop apps',
  'apps:config': 'App configuration',
  'apps:expose': 'App exposure toggle',
  'exposure:settings': 'Exposure settings',
  'backups:manage': 'Backups',
  'settings:manage': 'Settings',
  'audit:view': 'Audit log',
  'users:manage': 'Users & roles',
};

/** Optimistic capability set from roles alone — see the file header. */
export function capabilitiesFor(roles: readonly Role[] | undefined): Set<Capability> {
  const out = new Set<Capability>();
  for (const role of roles ?? []) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      out.add(capability);
    }
  }
  return out;
}
