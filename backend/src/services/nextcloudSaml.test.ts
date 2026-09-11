import { beforeEach, describe, expect, it, vi } from 'vitest';

const occ = vi.hoisted(() => ({ runNextcloudOccScript: vi.fn() }));
const exposure = vi.hoisted(() => ({ getServiceExposureRow: vi.fn() }));
const appEnv = vi.hoisted(() => ({ readAppEnvValue: vi.fn() }));
const registry = vi.hoisted(() => ({ resolveComposeFile: vi.fn() }));
const autheliaUsers = vi.hoisted(() => ({ getAutheliaAdminUser: vi.fn() }));

vi.mock('./nextcloudOcc', () => occ);
vi.mock('./exposure', () => exposure);
vi.mock('./appEnv', () => appEnv);
vi.mock('../config/services', () => registry);
vi.mock('./autheliaUsers', () => autheliaUsers);
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { reconcileNextcloudSaml, buildEnableScript, buildDisableScript } from './nextcloudSaml';

describe('buildEnableScript', () => {
  const script = buildEnableScript().join('\n');

  it('installs user_saml only when absent, then puts it in environment mode', () => {
    expect(script).toContain('if ! php occ app:getpath user_saml');
    expect(script).toContain('php occ app:install user_saml');
    expect(script).toContain('php occ app:enable user_saml');
    expect(script).toContain('config:app:set user_saml type --value "environment-variable"');
  });

  it('maps the uid + email + displayname on provider 1 to the forwarded header $_SERVER keys', () => {
    // Provider config (saml:config:set), not appconfig (config:app:set) — user_saml 6.x moved these (§330).
    expect(script).toContain('php occ saml:config:set 1 ');
    expect(script).toContain('--general-uid_mapping="HTTP_REMOTE_USER"');
    expect(script).toContain('--saml-attribute-mapping-email_mapping="HTTP_REMOTE_EMAIL"');
    expect(script).toContain('--saml-attribute-mapping-displayName_mapping="HTTP_REMOTE_NAME"');
    expect(script).toContain('--general-idp0_display_name="Authelia"');
    // These two stay in appconfig.
    expect(script).toContain('config:app:set user_saml general-require_provisioned_account --value "0"');
    expect(script).not.toContain('config:app:set user_saml general-uid_mapping');
  });
});

describe('buildDisableScript', () => {
  it('disables user_saml only when present, and is otherwise a no-op', () => {
    const script = buildDisableScript().join('\n');
    expect(script).toContain('if php occ app:getpath user_saml');
    expect(script).toContain('php occ app:disable user_saml');
  });
});

describe('buildEnableScript admin promotion', () => {
  it('adds no promotion step when no admin username is given', () => {
    expect(buildEnableScript().join('\n')).not.toContain('group:adduser admin');
  });

  it('promotes the account only if it already exists, and retries later if not', () => {
    const script = buildEnableScript('mat').join('\n');
    expect(script).toContain('if php occ user:info "$SSO_ADMIN_USER"');
    expect(script).toContain('php occ group:adduser admin "$SSO_ADMIN_USER"');
    expect(script).toContain('retries next start');
    // The username never appears literally — only through the env var.
    expect(script).not.toContain('group:adduser admin mat');
  });
});

describe('reconcileNextcloudSaml', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registry.resolveComposeFile.mockReturnValue({ composeFile: '/apps/nextcloud/docker-compose.yml' });
    occ.runNextcloudOccScript.mockResolvedValue({ ok: true, output: '' });
    autheliaUsers.getAutheliaAdminUser.mockReturnValue(null);
  });

  const scriptOf = () => occ.runNextcloudOccScript.mock.calls[0][0].join('\n') as string;

  it('is a no-op for a non-nextcloud service', async () => {
    await reconcileNextcloudSaml('immich');
    expect(occ.runNextcloudOccScript).not.toHaveBeenCalled();
  });

  it('enables environment mode when exposed and the toggle is true', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    appEnv.readAppEnvValue.mockReturnValue('true');

    await reconcileNextcloudSaml('nextcloud');
    expect(scriptOf()).toContain('type --value "environment-variable"');
  });

  it('disables user_saml when the toggle is false even though exposed', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    appEnv.readAppEnvValue.mockReturnValue('false');

    await reconcileNextcloudSaml('nextcloud');
    expect(scriptOf()).toContain('php occ app:disable user_saml');
  });

  it('disables user_saml when the toggle is true but Nextcloud is not exposed', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: false });
    appEnv.readAppEnvValue.mockReturnValue('true');

    await reconcileNextcloudSaml('nextcloud');
    expect(scriptOf()).toContain('php occ app:disable user_saml');
  });

  it('passes the Authelia admin username through the environment, not the script, when enabling', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    appEnv.readAppEnvValue.mockReturnValue('true');
    autheliaUsers.getAutheliaAdminUser.mockReturnValue({ username: 'mat', displayName: '', email: '', groups: [] });

    await reconcileNextcloudSaml('nextcloud');
    expect(scriptOf()).toContain('group:adduser admin "$SSO_ADMIN_USER"');
    const opts = occ.runNextcloudOccScript.mock.calls[0][1];
    expect(opts.env.SSO_ADMIN_USER).toBe('mat');
    expect(opts.passEnv).toEqual(['SSO_ADMIN_USER']);
  });

  it('does not attempt the promotion when there is no Authelia admin yet', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    appEnv.readAppEnvValue.mockReturnValue('true');
    autheliaUsers.getAutheliaAdminUser.mockReturnValue(null);

    await reconcileNextcloudSaml('nextcloud');
    expect(scriptOf()).not.toContain('group:adduser');
  });
});
