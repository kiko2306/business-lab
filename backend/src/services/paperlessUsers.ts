/**
 * Give Paperless users usable accounts behind Authelia.
 *
 * Behind Authelia, Paperless trusts the `Remote-User` header (§247) and
 * auto-creates whoever it names as a plain user with **no permissions** — the
 * UI shell loads, then `/api/ui_settings/` and `/api/saved_views/` answer 403
 * "You do not have permission" and the page is an error toast. Paperless's own
 * `PAPERLESS_ADMIN_USER` can't cover it (`manage_superuser` skips when any
 * superuser exists, the generated `admin`) and `PAPERLESS_ACCOUNT_DEFAULT_GROUPS`
 * only reaches allauth signups, not the Remote-User backend (§692).
 *
 * So, ahead of their first login: the Authelia admin becomes a superuser, and
 * every other Authelia user joins an "Authelia users" group holding ordinary
 * document permissions (everything in `documents` except workflows, plus UI
 * settings) — enough to use the app, not to configure it. Paperless's
 * object-level ownership still applies, so they see their own and unowned
 * documents, not each other's. Run on every Paperless start and after each
 * Authelia user sync, so a user added later is covered before they arrive.
 *
 * `docker compose run` + `manage.py shell`, not `exec` — same socket-proxy
 * constraint as docusealDb.ts. Names travel via `-e`, never in the script text.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser, listAutheliaUsernames } from './autheliaUsers';

export const PAPERLESS_SERVICE = 'paperless';

const SCRIPT = [
  'import json, os',
  'from django.contrib.auth.models import Group, Permission, User',
  'from django.db.models import Q',
  "group, _ = Group.objects.get_or_create(name='Authelia users')",
  "perms = Permission.objects.filter(Q(content_type__app_label='documents') | Q(codename__endswith='uisettings')).exclude(codename__contains='workflow')",
  'group.permissions.set(perms)',
  "def get(name):",
  '    u, created = User.objects.get_or_create(username=name)',
  '    if created:',
  '        u.set_unusable_password()',
  '        u.save()',
  '    return u',
  "admin = get(os.environ['PAPERLESS_FANOUT_ADMIN'])",
  'if not (admin.is_superuser and admin.is_staff):',
  '    admin.is_superuser = admin.is_staff = True',
  '    admin.save()',
  "for name in json.loads(os.environ['PAPERLESS_FANOUT_USERS']):",
  '    u = get(name)',
  '    if not u.is_superuser:',
  '        u.groups.add(group)',
  "print('done')",
].join('\n');

export async function reconcilePaperlessUsers(serviceName: string): Promise<void> {
  if (serviceName !== PAPERLESS_SERVICE) return;
  const resolved = resolveComposeFile(PAPERLESS_SERVICE);
  if (!resolved?.composeFile) return;

  const admin = getAutheliaAdminUser()?.username?.trim();
  if (!admin) {
    logger.warn('Paperless user provisioning skipped: no Authelia admin yet — complete the dashboard /setup first.');
    return;
  }

  const scriptB64 = Buffer.from(SCRIPT).toString('base64');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `-e PAPERLESS_FANOUT_ADMIN -e PAPERLESS_FANOUT_USERS --entrypoint /bin/sh paperless-ngx ` +
    `-c "cd /usr/src/paperless/src && echo ${scriptB64} | base64 -d | python3 manage.py shell"`;

  await new Promise<void>((resolve) => {
    exec(
      command,
      { timeout: 120_000, env: {
          ...process.env,
          PAPERLESS_FANOUT_ADMIN: admin,
          PAPERLESS_FANOUT_USERS: JSON.stringify(listAutheliaUsernames().filter((name) => name !== admin)),
        },
      },
      (error, stdout) => {
        if (error) logger.warn('Paperless user provisioning failed', { error: error.message });
        else if (stdout.toString().includes('done')) logger.info('Paperless: Authelia users provisioned', { admin });
        resolve();
      }
    );
  });
}
