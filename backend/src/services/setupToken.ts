import { exec } from 'child_process';
import { getService, getProjectName } from '../config/services';

function run(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

/**
 * Extract a service's one-time first-run setup token from its container's
 * logs, for services configured with `setupToken.logPattern` (see
 * config/services.ts). Returns null if the service doesn't support this,
 * has no container yet, or the pattern isn't found (already completed setup,
 * or the token line has scrolled out — logs aren't truncated here, so this
 * only happens if the container's own log retention dropped it).
 *
 * When the logs hold more than one match — which happens after a restart, e.g.
 * Portainer re-prints a fresh `setup_token=` every boot while admin creation
 * is still pending — the *last* one wins, since that's the token currently
 * valid.
 */
export async function getServiceSetupToken(serviceName: string): Promise<string | null> {
  const service = getService(serviceName);
  if (!service?.setupToken) {
    return null;
  }

  const projectName = getProjectName(serviceName);
  if (!projectName) {
    return null;
  }

  const containerName = (
    await run(`docker ps -a --filter "label=com.docker.compose.project=${projectName}" --format "{{.Names}}"`)
  )
    .trim()
    .split('\n')[0];

  if (!containerName) {
    return null;
  }

  // Strip ANSI escape codes (e.g. Portainer colorizes its log output) so
  // they can't get swept into the captured token by a trailing \S+.
  const logs = (await run(`docker logs ${containerName} 2>&1`)).replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[[0-9;]*m/g,
    ''
  );
  const pattern = new RegExp(service.setupToken.logPattern, 'g');
  let token: string | null = null;
  for (const match of logs.matchAll(pattern)) {
    token = match[1] ?? token;
  }
  return token;
}

/**
 * Poll for a service's setup token, for use right after a restart when the
 * container needs a beat to boot and print the token line. Resolves with the
 * first non-null read, or null once the attempts are exhausted.
 */
export async function waitForServiceSetupToken(
  serviceName: string,
  { attempts = 6, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {}
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const token = await getServiceSetupToken(serviceName);
    if (token) {
      return token;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}
