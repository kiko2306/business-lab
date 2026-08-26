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

  const logs = await run(`docker logs ${containerName} 2>&1`);
  const match = new RegExp(service.setupToken.logPattern).exec(logs);
  return match?.[1] ?? null;
}
