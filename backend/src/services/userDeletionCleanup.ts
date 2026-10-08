import { query } from '../utils/database';
import { getUserAppAccess } from './userAppAccess';
import { deprovisionNoSsoCredentials } from './noSsoCredentialFanout';

/**
 * Lock a dashboard account's logins in every no-SSO app it was granted
 * (Samba, Kimai, ...) — run BEFORE the `users` row is deleted. The
 * deprovisioners find the account by email through that row, and the
 * `user_app_access` cascade empties the grant list with it, so after the
 * delete there is nothing left to look up. Without this, a deleted user's
 * Samba account stayed enabled with its old password (found live on the dev
 * box: `claude`, `samba-test-admin`). Never throws.
 */
export async function deprovisionNoSsoAppsForUser(userId: number): Promise<void> {
  const result = await query<{ email: string | null }>('SELECT email FROM users WHERE id = $1', [userId]);
  const email = result.rows[0]?.email;
  if (!email) return;
  const apps = await getUserAppAccess(userId);
  if (apps.length === 0) return;
  await deprovisionNoSsoCredentials(apps, email);
}
