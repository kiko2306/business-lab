/**
 * Manages Authelia's file-based admin account (config/users_database.yml)
 * from the dashboard, instead of requiring manual YAML/hash editing.
 *
 * Scope is deliberately narrow: this edits the single account tagged with
 * the "admins" group (falling back to the first user in the file), not full
 * multi-user CRUD — that matches how every deployment of this app is
 * actually set up today.
 *
 * Password hashes are bcrypt, generated with the same `bcryptjs` library
 * already used for the dashboard's own accounts (see utils/password.ts).
 * Verified compatible with Authelia's file authentication backend via
 * `authelia crypto hash validate` against a bcryptjs-generated digest.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { resolveComposeFile } from '../config/services';
import { hashPassword } from '../utils/password';
import { HttpError } from '../types';

export interface AutheliaAdminUser {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
}

export interface AutheliaAdminUserUpdate {
  username: string;
  displayName: string;
  email: string;
  // Omitted or blank keeps the current password hash unchanged.
  password?: string;
}

export interface RawAutheliaUser {
  disabled?: boolean;
  displayname?: string;
  password?: string;
  email?: string;
  groups?: string[];
}

export interface UsersDatabaseFile {
  users?: Record<string, RawAutheliaUser>;
}

export function getUsersDatabasePath(): string | null {
  const resolved = resolveComposeFile('authelia');
  if (!resolved) {
    return null;
  }
  return path.join(resolved.appDir, 'config', 'users_database.yml');
}

/**
 * Splits the file into the human-written preamble (the header comments
 * above `users:`) and the parsed document, so a save can rewrite just the
 * `users:` section and leave the preamble intact.
 */
export function readUsersDatabase(filePath: string): { preamble: string; data: UsersDatabaseFile } {
  const raw = fs.readFileSync(filePath, 'utf8');
  const marker = raw.indexOf('\nusers:');
  const splitIndex = raw.startsWith('users:') ? 0 : marker === -1 ? -1 : marker + 1;
  const preamble = splitIndex > 0 ? raw.slice(0, splitIndex) : '';
  const data = (yaml.load(raw) as UsersDatabaseFile) ?? {};
  return { preamble, data };
}

function pickAdminEntry(data: UsersDatabaseFile): [string, RawAutheliaUser] | null {
  const entries = Object.entries(data.users ?? {});
  if (!entries.length) {
    return null;
  }
  return entries.find(([, user]) => (user.groups ?? []).includes('admins')) ?? entries[0];
}

export function getAutheliaAdminUser(): AutheliaAdminUser | null {
  const filePath = getUsersDatabasePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const entry = pickAdminEntry(readUsersDatabase(filePath).data);
  if (!entry) {
    return null;
  }

  const [username, user] = entry;
  return {
    username,
    displayName: user.displayname ?? '',
    email: user.email ?? '',
    groups: user.groups ?? [],
  };
}

export async function updateAutheliaAdminUser(update: AutheliaAdminUserUpdate): Promise<AutheliaAdminUser> {
  const filePath = getUsersDatabasePath();
  if (!filePath || !fs.existsSync(filePath)) {
    throw { statusCode: 404, message: 'Authelia is not installed.' } as HttpError;
  }

  const { preamble, data } = readUsersDatabase(filePath);
  const entry = pickAdminEntry(data);
  if (!entry) {
    throw { statusCode: 404, message: 'No Authelia admin account found to update.' } as HttpError;
  }

  const [currentUsername, currentUser] = entry;
  const passwordHash = update.password ? await hashPassword(update.password) : currentUser.password;
  if (!passwordHash) {
    throw { statusCode: 400, message: 'Authelia admin account has no password hash and none was provided.' } as HttpError;
  }

  const users = { ...(data.users ?? {}) };
  delete users[currentUsername];
  users[update.username] = {
    disabled: currentUser.disabled ?? false,
    displayname: update.displayName,
    password: passwordHash,
    email: update.email,
    groups: currentUser.groups ?? [],
  };

  const body = yaml.dump({ users }, { lineWidth: -1 });
  fs.writeFileSync(filePath, `${preamble}${body}`, { mode: 0o640 });

  return {
    username: update.username,
    displayName: update.displayName,
    email: update.email,
    groups: currentUser.groups ?? [],
  };
}
