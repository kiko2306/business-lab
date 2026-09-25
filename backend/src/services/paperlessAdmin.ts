/**
 * Make the Authelia admin a Paperless superuser.
 *
 * Behind Authelia, Paperless trusts the `Remote-User` header (§247) and
 * auto-creates whoever it names as a plain user with **no permissions** — the
 * UI shell loads, then `/api/ui_settings/` and `/api/saved_views/` answer 403
 * "You do not have permission" and the page is an error toast. Paperless's own
 * `PAPERLESS_ADMIN_USER` can't cover it: `manage_superuser` skips when any
 * superuser already exists (the generated `admin`). Found live 2026-09-25.
 *
 * `docker compose run` + `manage.py shell`, not `exec` — same socket-proxy
 * constraint as docusealDb.ts. The username travels via `-e`, never in the
 * script text. Other Authelia users still get the permissionless account:
 * what a non-admin may do with shared documents is a policy call, not a
 * bootstrap one.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser } from './autheliaUsers';

export const PAPERLESS_SERVICE = 'paperless';

const SCRIPT = [
  'import os',
  'from django.contrib.auth.models import User',
  "u, created = User.objects.get_or_create(username=os.environ['PAPERLESS_FANOUT_USER'])",
  'if created:',
  '    u.set_unusable_password()',
  'if created or not (u.is_superuser and u.is_staff):',
  '    u.is_superuser = u.is_staff = True',
  '    u.save()',
  "    print('promoted')",
  'else:',
  "    print('unchanged')",
].join('\n');

export async function reconcilePaperlessAdmin(serviceName: string): Promise<void> {
  if (serviceName !== PAPERLESS_SERVICE) return;
  const resolved = resolveComposeFile(PAPERLESS_SERVICE);
  if (!resolved?.composeFile) return;

  const username = getAutheliaAdminUser()?.username?.trim();
  if (!username) {
    logger.warn('Paperless admin promotion skipped: no Authelia admin yet — complete the dashboard /setup first.');
    return;
  }

  const scriptB64 = Buffer.from(SCRIPT).toString('base64');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `-e PAPERLESS_FANOUT_USER --entrypoint /bin/sh paperless-ngx ` +
    `-c "cd /usr/src/paperless/src && echo ${scriptB64} | base64 -d | python3 manage.py shell"`;

  await new Promise<void>((resolve) => {
    exec(
      command,
      { timeout: 120_000, env: { ...process.env, PAPERLESS_FANOUT_USER: username } },
      (error, stdout) => {
        if (error) logger.warn('Paperless admin promotion failed', { error: error.message });
        else if (stdout.toString().includes('promoted')) logger.info('Paperless: promoted the Authelia admin to superuser', { username });
        resolve();
      }
    );
  });
}
