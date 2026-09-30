/** Where a provisioning-checklist "set it in X" name (deploymentStatus.ts `fixIn`) leads. */
export interface FixTarget {
  labelKey: string;
  /** A page elsewhere in the dashboard. */
  route?: string;
  /** A panel on the Settings page: opened, then scrolled to by its `anchor`. */
  panelKey?: string;
  anchor?: string;
}

// Keyed by the backend's English name because that is what it sends; an unknown
// name returns null and the checklist falls back to plain text.
const TARGETS: Record<string, FixTarget> = {
  Networking: { labelKey: 'settings.deployment.fixIn.networking', panelKey: 'settings:cloudflare', anchor: 'cloudflare' },
  Email: { labelKey: 'settings.deployment.fixIn.email', panelKey: 'settings:email', anchor: 'email' },
  'Backup destination': { labelKey: 'settings.deployment.fixIn.backups', route: '/backups' },
  'Users page': { labelKey: 'settings.deployment.fixIn.users', route: '/users' },
};

export function fixTarget(fixIn: string): FixTarget | null {
  return TARGETS[fixIn] ?? null;
}
