import { Role } from './models';

/**
 * Frontend mirror of `backend/src/auth/capabilities.ts` (plan.md §149). Kept
 * as a constant rather than fetched from `/api/auth/me` so the UI can gate nav
 * and buttons synchronously, with no frame where everything is hidden while a
 * request is in flight. The backend is still the authority — every gated route
 * re-checks — so a drift here only ever shows a control the API then refuses.
 * Update both files together.
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

const ALL: Capability[] = [
  'apps:control',
  'apps:config',
  'apps:expose',
  'exposure:settings',
  'backups:manage',
  'settings:manage',
  'audit:view',
  'users:manage',
];

const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: ALL,
  it_admin: ['apps:control', 'apps:config', 'apps:expose', 'backups:manage', 'settings:manage', 'audit:view'],
  webmaster: ['exposure:settings'],
  user: [],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  it_admin: 'IT admin',
  webmaster: 'Webmaster',
  user: 'User',
};

export function capabilitiesFor(roles: readonly Role[] | undefined): Set<Capability> {
  const out = new Set<Capability>();
  for (const role of roles ?? []) {
    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      out.add(capability);
    }
  }
  return out;
}
