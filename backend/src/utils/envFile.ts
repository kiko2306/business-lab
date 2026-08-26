import fs from 'fs';

/**
 * Minimal .env parser: KEY=value pairs, ignoring blank lines and comments.
 * Does not attempt shell-style quoting/escaping.
 */
export function parseEnvFile(envFilePath: string): Record<string, string> {
  const envContent = fs.readFileSync(envFilePath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  const values: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    values[key] = value;
  }

  return values;
}
