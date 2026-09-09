import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * The version shown in the dashboard footer and reported by `/version`.
 *
 * Source of truth is the repo-root `VERSION` file (plan.md §343), read **on
 * every call** — the repo is bind-mounted read-write into the backend, so a
 * `git pull` that only bumped `VERSION` is reflected live with no rebuild or
 * restart. `scripts/bump-version.sh` writes it; `package.json` is no longer
 * bumped per release and is only the last-ditch fallback here.
 *
 * Lookup order:
 *  1. `$REPO_ROOT/VERSION` — the bind-mounted checkout in the deployed stack.
 *  2. `<two levels up from __dirname>/VERSION` — covers a local `ng`/`tsc`
 *     run with no REPO_ROOT (dist/ and src/ are both one dir under backend/).
 *  3. the image's `package.json` version — a frozen 0.6x value, better than
 *     nothing if the file is somehow missing.
 *  4. `0.0.0`.
 */
function readVersionFile(path: string): string | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    return SEMVER.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readPackageVersion(): string | null {
  try {
    const raw = readFileSync(join(__dirname, '..', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && SEMVER.test(parsed.version.trim())) {
      return parsed.version.trim();
    }
  } catch {
    // fall through
  }
  return null;
}

export function getAppVersion(): string {
  const fromRepoRoot = process.env.REPO_ROOT ? readVersionFile(join(process.env.REPO_ROOT, 'VERSION')) : null;
  return (
    fromRepoRoot ??
    readVersionFile(join(__dirname, '..', '..', 'VERSION')) ??
    readPackageVersion() ??
    '0.0.0'
  );
}

/**
 * Boot-time snapshot. Kept for callers that don't need to see a mid-run
 * `git pull` — anything user-facing (`/version`, `/health`, the self-update
 * status) should call `getAppVersion()` so a version-only deploy shows up
 * without waiting for a restart.
 */
export const APP_VERSION = getAppVersion();
