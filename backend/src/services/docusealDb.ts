/**
 * Reach DocuSeal through its own runtime — `docker compose run`, `bin/rails
 * runner` against a one-off container from its own image — rather than its
 * data files, for the operations its HTTP forms can't do at all.
 *
 * `setDocusealUserPassword`: DocuSeal's own `UsersController#update` always
 * strips `:password` from what an admin can change on another user
 * (confirmed by reading the controller source, not guessed:
 * `attrs.except(*(current_user == @user ? %i[password otp_required_for_login
 * role] : %i[password]))` excludes `:password` in both branches) — so there
 * is no HTTP form that can do this. The model layer has no such
 * restriction: `User#update!(password:)` goes through Devise's own
 * `password=` setter and gets bcrypt-hashed exactly the way Devise expects.
 *
 * `archiveDocusealUser` (§493): the HTTP `destroy` action already does
 * exactly this (`@user.update!(archived_at: Time.current)`, reversible —
 * re-inviting the same email un-archives it) but needs the user's numeric
 * id, which would mean scraping the users listing page first. Going
 * through the model directly needs only the email, same as the password
 * path, and sets the identical column.
 *
 * `reconcileDocusealAdminPassword` (§495): `docusealAdminBootstrap.ts` already
 * re-syncs the admin's *email* on drift (`syncAdminEmail`) but had nothing
 * for the password — found live (2026-09-16), the tracked
 * `DOCUSEAL_ADMIN_PASSWORD` no longer signed in at all. Same idea as
 * `itflowAdminBootstrap.ts`'s `reconcileAdminPassword`: check with
 * `valid_password?` first, so a normal start where nothing changed writes
 * nothing, then update only on an actual mismatch — no live session
 * needed either way, unlike ITFlow's version (DocuSeal's password column
 * carries no session-bound encryption key to re-wrap).
 *
 * `docker compose run`, not `exec` — same socket-proxy constraint as
 * nextcloudOcc.ts/itflowDb.ts. Email/password travel in through `-e NAME`
 * environment variables, never interpolated into the script text.
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const DOCUSEAL_SERVICE = 'docuseal';
const RAILS_BIN = '/app/bin/rails';

/** Run `script` through `bin/rails runner` in a one-off DocuSeal container. Returns trimmed stdout, or null on any failure. */
async function runDocusealRailsScript(script: string, passEnv: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  const resolved = resolveComposeFile(DOCUSEAL_SERVICE);
  if (!resolved?.composeFile) {
    return null;
  }

  const scriptB64 = Buffer.from(script).toString('base64');
  const passFlags = passEnv.map((name) => `-e ${name}`).join(' ');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `${passFlags} --entrypoint /bin/sh docuseal ` +
    `-c "echo ${scriptB64} | base64 -d | ${RAILS_BIN} runner -"`;

  return new Promise((resolve) => {
    exec(command, { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env }, (error, stdout) => {
      resolve(error ? null : stdout.toString().trim());
    });
  });
}

export type DocusealSetPasswordResult = 'updated' | 'not-found' | 'failed';

// `.active` excludes archived users — reviving one goes through a separate,
// already-broken path (DocuSeal's own `create` ignores the submitted
// password when reviving an archived account), not this one.
const SET_PASSWORD_SCRIPT = [
  "u = User.active.find_by(email: ENV['DOCUSEAL_FANOUT_EMAIL'])",
  'if u',
  "  u.update!(password: ENV['DOCUSEAL_FANOUT_PASSWORD'])",
  "  puts 'updated'",
  'else',
  "  puts 'not-found'",
  'end',
].join('\n');

export async function setDocusealUserPassword(email: string, password: string): Promise<DocusealSetPasswordResult> {
  const output = await runDocusealRailsScript(
    SET_PASSWORD_SCRIPT,
    ['DOCUSEAL_FANOUT_EMAIL', 'DOCUSEAL_FANOUT_PASSWORD'],
    { ...process.env, DOCUSEAL_FANOUT_EMAIL: email, DOCUSEAL_FANOUT_PASSWORD: password }
  );
  if (output === 'updated') return 'updated';
  if (output === 'not-found') return 'not-found';
  return 'failed';
}

export type DocusealArchiveResult = 'archived' | 'not-found' | 'failed';

const ARCHIVE_SCRIPT = [
  "u = User.active.find_by(email: ENV['DOCUSEAL_FANOUT_EMAIL'])",
  'if u',
  "  u.update!(archived_at: Time.current)",
  "  puts 'archived'",
  'else',
  "  puts 'not-found'",
  'end',
].join('\n');

/** §493: revoking dashboard access locks the DocuSeal account without deleting it — same archive the HTTP `destroy` action performs. */
export async function archiveDocusealUser(email: string): Promise<DocusealArchiveResult> {
  const output = await runDocusealRailsScript(ARCHIVE_SCRIPT, ['DOCUSEAL_FANOUT_EMAIL'], {
    ...process.env,
    DOCUSEAL_FANOUT_EMAIL: email,
  });
  if (output === 'archived') return 'archived';
  if (output === 'not-found') return 'not-found';
  return 'failed';
}

export type DocusealReconcilePasswordResult = 'synced' | 'unchanged' | 'not-found' | 'failed';

const RECONCILE_PASSWORD_SCRIPT = [
  "u = User.active.find_by(email: ENV['DOCUSEAL_FANOUT_EMAIL'])",
  'if u',
  "  if u.valid_password?(ENV['DOCUSEAL_FANOUT_PASSWORD'])",
  "    puts 'unchanged'",
  '  else',
  "    u.update!(password: ENV['DOCUSEAL_FANOUT_PASSWORD'])",
  "    puts 'synced'",
  '  end',
  'else',
  "  puts 'not-found'",
  'end',
].join('\n');

/** §495: sync the admin's password only when it has actually drifted from the config-panel value. */
export async function reconcileDocusealAdminPassword(email: string, password: string): Promise<DocusealReconcilePasswordResult> {
  const output = await runDocusealRailsScript(
    RECONCILE_PASSWORD_SCRIPT,
    ['DOCUSEAL_FANOUT_EMAIL', 'DOCUSEAL_FANOUT_PASSWORD'],
    { ...process.env, DOCUSEAL_FANOUT_EMAIL: email, DOCUSEAL_FANOUT_PASSWORD: password }
  );
  if (output === 'synced') return 'synced';
  if (output === 'unchanged') return 'unchanged';
  if (output === 'not-found') return 'not-found';
  return 'failed';
}
