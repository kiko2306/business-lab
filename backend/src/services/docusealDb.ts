/**
 * Set an existing DocuSeal team member's password directly via `bin/rails
 * runner`, in a one-off container from DocuSeal's own image — same "reach
 * the app through its own runtime, not its data files" approach as
 * itflowDb.ts.
 *
 * Needed because DocuSeal's own `UsersController#update` always strips
 * `:password` from what an admin can change on another user (confirmed by
 * reading the controller source, not guessed:
 * `attrs.except(*(current_user == @user ? %i[password otp_required_for_login
 * role] : %i[password]))` excludes `:password` in both branches) — so there
 * is no HTTP form that can do this. The model layer has no such
 * restriction: `User#update!(password:)` goes through Devise's own
 * `password=` setter and gets bcrypt-hashed exactly the way Devise expects
 * (whatever its cost/pepper happen to be), unlike hand-computing a bcrypt
 * hash ourselves and writing it into the sqlite file directly, which would
 * silently drift the moment DocuSeal's own devise.rb config changes.
 *
 * `docker compose run`, not `exec` — same socket-proxy constraint as
 * nextcloudOcc.ts/itflowDb.ts. Email/password travel in through `-e NAME`
 * environment variables, never interpolated into the script text (same
 * reasoning as itflowDb.ts).
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const DOCUSEAL_SERVICE = 'docuseal';
const RAILS_BIN = '/app/bin/rails';

export type DocusealSetPasswordResult = 'updated' | 'not-found' | 'failed';

// `.active` excludes archived users — reviving one goes through a separate,
// already-broken path (DocuSeal's own `create` ignores the submitted
// password when reviving an archived account), not this one.
const SCRIPT = [
  "u = User.active.find_by(email: ENV['DOCUSEAL_FANOUT_EMAIL'])",
  'if u',
  "  u.update!(password: ENV['DOCUSEAL_FANOUT_PASSWORD'])",
  "  puts 'updated'",
  'else',
  "  puts 'not-found'",
  'end',
].join('\n');

export async function setDocusealUserPassword(email: string, password: string): Promise<DocusealSetPasswordResult> {
  const resolved = resolveComposeFile(DOCUSEAL_SERVICE);
  if (!resolved?.composeFile) {
    return 'failed';
  }

  const scriptB64 = Buffer.from(SCRIPT).toString('base64');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `-e DOCUSEAL_FANOUT_EMAIL -e DOCUSEAL_FANOUT_PASSWORD --entrypoint /bin/sh docuseal ` +
    `-c "echo ${scriptB64} | base64 -d | ${RAILS_BIN} runner -"`;

  return new Promise((resolve) => {
    exec(
      command,
      {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, DOCUSEAL_FANOUT_EMAIL: email, DOCUSEAL_FANOUT_PASSWORD: password },
      },
      (error, stdout) => {
        if (error) {
          resolve('failed');
          return;
        }
        const output = stdout.toString().trim();
        resolve(output === 'updated' ? 'updated' : output === 'not-found' ? 'not-found' : 'failed');
      }
    );
  });
}
