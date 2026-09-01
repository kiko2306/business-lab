/**
 * HACS (the Home Assistant Community Store) installed automatically, because
 * §0.2/§0.3 say a human never runs a console step and the system installs what
 * it can derive on its own.
 *
 * Why it's needed at all: several appliances in this house have no core
 * Home Assistant integration and never will — they are cloud-only appliances
 * whose vendors publish no local API. Beko/Arçelik washing machines
 * (`home-assistant-HomeWhiz`) and Ariston water heaters
 * (`fustom/ariston-remotethermo-home-assistant-v3`) are both HACS repositories,
 * so without HACS those appliances simply cannot be added. HA's own discovery
 * can't help: neither appliance opens a port or answers mDNS (plan.md §77).
 *
 * Why it lives here rather than in start.sh: every `apps/<app>/data/` directory
 * is gitignored, so a
 * fresh clone starts with an empty HA config directory — and HA may be
 * installed from the dashboard long after start.sh last ran. Running on every
 * Home Assistant start instead means a fresh clone, a reinstall and a
 * hand-deleted custom_components directory all converge on the same state.
 * Same point in startService as buildExposureEnvOverrides /
 * applyExposureConfigFiles / applyCrowdsecConfigFiles.
 *
 * /config is owned by HA's root container and isn't writable by the
 * dashboard's own (non-root) process, so — exactly as in exposureConfigFiles —
 * the work happens inside a throwaway `docker compose run` container built
 * from HA's own image and volume mounts.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';

const HACS_DIR = '/config/custom_components/hacs';
// The published release asset, not `main`: once installed, HACS updates itself
// from within HA and it tracks releases, so seeding it from anything else would
// leave it permanently "behind" a version it can't reconcile.
const HACS_ZIP_URL = 'https://github.com/hacs/integration/releases/latest/download/hacs.zip';

function run(command: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * The /bin/sh script that runs inside the throwaway HA container.
 *
 * Installs only when HACS is absent — never overwrites, never "upgrades". HACS
 * has its own in-app updater, and stamping the latest release over a running
 * install on every restart would fight it and could downgrade a user who took
 * a newer version through the UI.
 *
 * Unpacks to a scratch directory and moves it into place only once
 * `manifest.json` is there, so an interrupted download or a truncated zip can
 * never leave a half-populated `custom_components/hacs` — which HA would try to
 * load and fail on, taking out the whole integration with it.
 */
function buildHacsInstallScript(): string {
  const stage = '/config/custom_components/.hacs-staging';
  return [
    'set -e',
    'if [ -f ' + HACS_DIR + '/manifest.json ]; then',
    '  echo "hlm: HACS already installed"',
    '  exit 0',
    'fi',
    'mkdir -p /config/custom_components',
    'rm -rf ' + stage,
    'mkdir -p ' + stage,
    // Past this point every failure path clears the staging directory and
    // exits 0: the next start simply retries.
    'if ! curl -fsSL -o /tmp/hacs.zip ' + HACS_ZIP_URL + '; then',
    '  rm -rf ' + stage + ' /tmp/hacs.zip',
    '  echo "hlm: could not download HACS (no network?); Home Assistant starts without it"',
    '  exit 0',
    'fi',
    'python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" /tmp/hacs.zip ' + stage,
    'rm -f /tmp/hacs.zip',
    'if [ ! -f ' + stage + '/manifest.json ]; then',
    '  rm -rf ' + stage,
    '  echo "hlm: downloaded HACS archive had no manifest.json; not installing"',
    '  exit 0',
    'fi',
    'mv ' + stage + ' ' + HACS_DIR,
    'echo "hlm: installed HACS into ' + HACS_DIR + '"',
  ].join('\n');
}

/**
 * Make sure Home Assistant has HACS before it starts. No-op for every other
 * service, and never fatal: HA starting without HACS is a missing feature, not
 * a broken app, so a download failure must not block the start.
 */
export async function ensureHomeAssistantHacs(serviceName: string): Promise<void> {
  if (serviceName !== 'home-assistant') {
    return;
  }

  const resolved = resolveComposeFile(serviceName);
  if (!resolved?.composeFile) {
    logger.info('Home Assistant compose file not found; skipping HACS install');
    return;
  }

  try {
    const scriptB64 = Buffer.from(buildHacsInstallScript()).toString('base64');
    const command =
      `docker compose -p ${resolved.projectName} -f ${resolved.composeFile} run --rm --no-deps -T ` +
      `--entrypoint /bin/sh home-assistant -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

    const output = await run(command);
    logger.info('Home Assistant HACS reconciled', { output: output.trim() || '(no changes)' });
  } catch (error) {
    logger.error('Failed to install HACS for Home Assistant', { error: (error as Error).message });
  }
}

export const __test = { buildHacsInstallScript, HACS_DIR, HACS_ZIP_URL };
