import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAutheliaAdminUser, updateAutheliaAdminUser } from './autheliaUsers';

// 'authelia' is a real registry entry whose app directory (basename of its
// configured composePath) is 'authelia'; pointing APPS_DIR at a temp root
// and writing config/users_database.yml under <tmp>/authelia/ lets
// resolveComposeFile() find it without touching the checked-in fixtures
// under apps/authelia/, which this test doesn't want to depend on.
describe('autheliaUsers', () => {
  let tmpDir: string;
  let originalAppsDir: string | undefined;
  let configDir: string;
  let usersFile: string;

  const SAMPLE_FILE = `###############################################################
#                         Users Database                      #
###############################################################
# Generate a real password hash before going anywhere near production:
#   docker run --rm authelia/authelia:latest authelia crypto hash generate argon2 --password 'yourpassword'
# then replace the example entry below (or add more users).

users:
  authelia:
    disabled: false
    displayname: 'Authelia Admin'
    password: '$argon2id$v=19$m=65536,t=3,p=4$55n0xVn2J7LmEmoTdQpUmA$TdtMN/UVRWw9P1NwSOT3etXN3j/bt4BuFZMTk7+tWGM'
    email: admin@localhost
    groups:
      - admins
`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'authelia-users-test-'));
    configDir = path.join(tmpDir, 'authelia', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    usersFile = path.join(configDir, 'users_database.yml');
    fs.writeFileSync(usersFile, SAMPLE_FILE);

    originalAppsDir = process.env.APPS_DIR;
    process.env.APPS_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalAppsDir === undefined) {
      delete process.env.APPS_DIR;
    } else {
      process.env.APPS_DIR = originalAppsDir;
    }
  });

  describe('getAutheliaAdminUser', () => {
    it('reads the admin user from the file', () => {
      expect(getAutheliaAdminUser()).toEqual({
        username: 'authelia',
        displayName: 'Authelia Admin',
        email: 'admin@localhost',
        groups: ['admins'],
      });
    });

    it('returns null when the file does not exist', () => {
      fs.rmSync(usersFile);
      expect(getAutheliaAdminUser()).toBeNull();
    });

    it('picks the user tagged "admins" among multiple users', () => {
      fs.writeFileSync(
        usersFile,
        'users:\n' +
          '  someoneelse:\n' +
          '    disabled: false\n' +
          "    displayname: 'Someone Else'\n" +
          "    password: '$argon2id$fake'\n" +
          '    email: someone@localhost\n' +
          '    groups:\n' +
          '      - users\n' +
          '  authelia:\n' +
          '    disabled: false\n' +
          "    displayname: 'Authelia Admin'\n" +
          "    password: '$argon2id$fake2'\n" +
          '    email: admin@localhost\n' +
          '    groups:\n' +
          '      - admins\n'
      );
      expect(getAutheliaAdminUser()?.username).toBe('authelia');
    });
  });

  describe('updateAutheliaAdminUser', () => {
    it('updates display name, email, and username, keeping the password hash when none is given', async () => {
      const result = await updateAutheliaAdminUser({
        username: 'newadmin',
        displayName: 'New Admin',
        email: 'new@example.com',
      });

      expect(result).toEqual({
        username: 'newadmin',
        displayName: 'New Admin',
        email: 'new@example.com',
        groups: ['admins'],
      });

      const raw = fs.readFileSync(usersFile, 'utf8');
      expect(raw).toContain('# Generate a real password hash'); // preamble preserved
      expect(raw).toContain('newadmin:');
      expect(raw).not.toContain('  authelia:');
      expect(raw).toContain('$argon2id$v=19$m=65536,t=3,p=4$55n0xVn2J7LmEmoTdQpUmA$TdtMN/UVRWw9P1NwSOT3etXN3j/bt4BuFZMTk7+tWGM');
    });

    it('hashes a new password with bcrypt', async () => {
      await updateAutheliaAdminUser({
        username: 'authelia',
        displayName: 'Authelia Admin',
        email: 'admin@localhost',
        password: 'brand-new-password',
      });

      const raw = fs.readFileSync(usersFile, 'utf8');
      const match = raw.match(/password: (\$2[aby]\$\S+)/);
      expect(match).not.toBeNull();
    });

    it('throws 404 when there is no users_database.yml', async () => {
      fs.rmSync(usersFile);
      await expect(
        updateAutheliaAdminUser({ username: 'authelia', displayName: 'x', email: 'x@x.com' })
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
