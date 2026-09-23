import fs from 'fs';

/**
 * Compose interpolates the values it reads out of a project `.env` — `$USER`
 * in a value becomes the host's username, `${FOO}` becomes whatever `FOO` is,
 * and an undefined name becomes empty. No app here uses `env_file:` (which
 * would pass values through untouched); every compose file consumes its `.env`
 * as `KEY: ${KEY:-}`, so every value written here is interpolated before the
 * container ever sees it. `$$` is Compose's escape for a literal `$`, so that
 * is what a `$` has to be written as — and read back as, to stay symmetric for
 * the callers that compare a stored value against the desired one.
 *
 * Values written before this escaping existed are still raw on disk; a single
 * `$` reads back unchanged, and rewriting the value fixes it for Compose.
 */
export function escapeEnvValue(value: string): string {
  return value.replace(/\$/g, '$$$$');
}

function unescapeEnvValue(value: string): string {
  return value.replace(/\$\$/g, '$');
}

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
    values[key] = unescapeEnvValue(value);
  }

  return values;
}

/**
 * Set each given KEY in an `.env` file, replacing the existing line or
 * appending one, and write the file back only if something actually changed.
 * Creates the file if it is absent.
 *
 * Line-based on purpose. This replaced two identical regex versions (Kopia's
 * backup destination and WebDAV's storage mount) that built the new line as a
 * `String.replace` *replacement string* — so a `$&`, `` $` ``, `$'` or `$1`
 * anywhere in the value expanded instead of being written literally. Every
 * value these two callers write is a user-entered secret (a WebDAV or S3
 * password, an SMB `password=` mount option), which is exactly where a `$`
 * turns up and exactly where a silent corruption is hardest to diagnose: the
 * `.env` looks plausible and Kopia just fails to connect.
 */
export function writeEnvValues(envFilePath: string, values: Record<string, string>): void {
  const existing = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const lines = existing === '' ? [] : existing.replace(/\n$/, '').split('\n');

  for (const [key, value] of Object.entries(values)) {
    const escaped = escapeEnvValue(value);
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${escaped}`;
    } else {
      lines.push(`${key}=${escaped}`);
    }
  }

  const updated = lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  if (updated !== existing) {
    fs.writeFileSync(envFilePath, updated);
  }
}
