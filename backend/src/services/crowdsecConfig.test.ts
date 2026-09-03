import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { __test } from './crowdsecConfig';

const {
  buildBouncerConfig,
  buildNpmRealIpBlock,
  buildNpmBouncerBlock,
  buildNpmBouncerConf,
  buildProfilesYaml,
  buildHttpNotificationYaml,
  replaceMarkedBlock,
  NPM_REALIP_MARKER_BEGIN,
  NPM_REALIP_MARKER_END,
  NPM_BOUNCER_MARKER_BEGIN,
  NPM_BOUNCER_MARKER_END,
} = __test;

describe('buildBouncerConfig (cloudflare-worker-bouncer)', () => {
  const cfg = buildBouncerConfig({
    lapiKey: 'lapi-key-123',
    accountId: 'acc-1',
    zoneId: 'zone-1',
    apiToken: 'cf-token-xyz',
  });

  it('points the bouncer at the agent over the compose network', () => {
    expect(cfg.crowdsec_config.lapi_url).toBe('http://crowdsec:8080/');
    expect(cfg.crowdsec_config.lapi_key).toBe('lapi-key-123');
  });

  it('nests the Cloudflare account, token and zone with a ban action, no turnstile', () => {
    const account = cfg.cloudflare_config.accounts[0];
    expect(account.id).toBe('acc-1');
    expect(account.token).toBe('cf-token-xyz');
    expect(account.default_action).toBe('ban');
    const zone = account.zones[0];
    expect(zone.zone_id).toBe('zone-1');
    expect(zone.actions).toEqual(['ban']);
    expect(zone.turnstile.enabled).toBe(false);
    expect(zone.routes_to_protect).toEqual([]);
  });

  it('serialises to valid YAML that round-trips', () => {
    const dumped = yaml.dump(cfg, { lineWidth: -1 });
    expect(yaml.load(dumped)).toEqual(cfg);
  });
});

describe('buildProfilesYaml', () => {
  it('references http_default under notifications when alerting is enabled', () => {
    const docs = yaml.loadAll(buildProfilesYaml(true)) as Array<{ name: string; notifications: string[] }>;
    expect(docs.map((d) => d.name)).toEqual(['default_ip_remediation', 'default_range_remediation']);
    for (const doc of docs) {
      expect(doc.notifications).toEqual(['http_default']);
      // The ban decision must survive regardless of the notification toggle —
      // this file is also what produces decisions.
    }
  });

  it('comments the notification out when alerting is disabled, keeping the ban', () => {
    const yamlText = buildProfilesYaml(false);
    expect(yamlText).toContain('# - http_default');
    const docs = yaml.loadAll(yamlText) as Array<{ notifications: unknown; decisions: { type: string }[] }>;
    for (const doc of docs) {
      expect(doc.notifications).toBeNull();
      expect(doc.decisions[0].type).toBe('ban');
    }
  });
});

describe('buildHttpNotificationYaml', () => {
  const cfg = yaml.load(
    buildHttpNotificationYaml('http://host.docker.internal:10240/webhook/crowdsec-alert')
  ) as Record<string, unknown>;

  it('is the http_default plugin posting JSON to the given url', () => {
    expect(cfg.type).toBe('http');
    expect(cfg.name).toBe('http_default');
    expect(cfg.method).toBe('POST');
    expect(cfg.url).toBe('http://host.docker.internal:10240/webhook/crowdsec-alert');
    expect((cfg.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends the raw alert list as JSON — the n8n relay workflow reshapes it', () => {
    expect((cfg.format as string).trim()).toBe('{{ .|toJson }}');
  });

  it('batches bursts rather than sending one push per alert', () => {
    expect(cfg.group_wait).toBe('30s');
    // int, not "10" — CrowdSec's plugin config rejects a quoted threshold.
    expect(cfg.group_threshold).toBe(10);
  });
});

describe('buildNpmRealIpBlock', () => {
  const block = buildNpmRealIpBlock();

  it('is marker-fenced so it can be rewritten in place', () => {
    expect(block.startsWith(NPM_REALIP_MARKER_BEGIN)).toBe(true);
    expect(block).toContain(NPM_REALIP_MARKER_END);
  });

  it('trusts Cloudflare ranges for the real_ip module', () => {
    expect(block).toContain('set_real_ip_from 173.245.48.0/20;');
    expect(block).toContain('set_real_ip_from 2400:cb00::/32;');
  });

  // §99: NPM's own nginx.conf unconditionally declares both, so a duplicate
  // here fails nginx's config test and silently breaks every future
  // proxy-host create/update/delete.
  it('does not declare real_ip_header or real_ip_recursive, which NPM already sets', () => {
    const directiveLines = block.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(directiveLines.some((line) => line.includes('real_ip_header'))).toBe(false);
    expect(directiveLines.some((line) => line.includes('real_ip_recursive'))).toBe(false);
  });
});

describe('buildNpmBouncerConf', () => {
  const conf = buildNpmBouncerConf('nginx-bouncer-key-abc');
  const keys = Object.fromEntries(
    conf
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  );

  it('authenticates to LAPI over the shared network, not a published port', () => {
    expect(keys.API_URL).toBe('http://crowdsec:8080');
    expect(keys.API_KEY).toBe('nginx-bouncer-key-abc');
    expect(keys.ENABLED).toBe('true');
  });

  // Stream mode is what makes a CrowdSec outage fail *open*: the per-request
  // path only reads the local decision cache, and a miss means "allow".
  it('pulls decisions in stream mode rather than querying LAPI per request', () => {
    expect(keys.MODE).toBe('stream');
    expect(Number(keys.UPDATE_FREQUENCY)).toBeGreaterThan(0);
  });

  // FALLBACK_REMEDIATION only governs AppSec failures and is validated against
  // {ban, captcha}: the `bypass` §119 first specified would be coerced to
  // `ban`, i.e. fail-closed. Omitting it is the fix, so it must stay omitted.
  it('omits FALLBACK_REMEDIATION, whose only valid values would fail closed', () => {
    expect(keys).not.toHaveProperty('FALLBACK_REMEDIATION');
  });

  it('bounces bans only — captcha would need a third-party account', () => {
    expect(keys.BOUNCING_ON_TYPE).toBe('ban');
    expect(keys.CAPTCHA_PROVIDER).toBe('');
    expect(keys.SITE_KEY).toBe('');
    expect(keys.APPSEC_URL).toBe('');
  });

  it('points at the vendored ban page inside the container mount', () => {
    expect(keys.BAN_TEMPLATE_PATH).toBe('/crowdsec/templates/ban.html');
  });
});

describe('buildNpmBouncerBlock', () => {
  const block = buildNpmBouncerBlock();

  it('is marker-fenced, separately from the real-IP block', () => {
    expect(block.startsWith(NPM_BOUNCER_MARKER_BEGIN)).toBe(true);
    expect(block).toContain(NPM_BOUNCER_MARKER_END);
    expect(block).not.toContain(NPM_REALIP_MARKER_BEGIN);
  });

  it('loads the vendored library and the generated config from the /crowdsec mount', () => {
    expect(block).toContain("lua_package_path '/crowdsec/lua/?.lua;;';");
    expect(block).toContain('cs.init("/crowdsec/crowdsec-nginx-bouncer.conf"');
  });

  it('declares the shared dict the bouncer caches decisions in', () => {
    expect(block).toMatch(/lua_shared_dict\s+crowdsec_cache\s+\d+m;/);
  });

  // The whole point of running here rather than at the edge: nginx's real_ip
  // module has already rewritten remote_addr to the client Cloudflare saw.
  it('checks remote_addr, so bans target the real client and not cloudflared', () => {
    expect(block).toContain('cs.Allow(ngx.var.remote_addr)');
    expect(block).not.toContain('$proxy_add_x_forwarded_for');
  });

  // Upstream's snippet names this `$unix`, which is far too generic to add to
  // someone else's http{} — a collision there is a config-test failure, and a
  // config-test failure in NPM is every proxied site down (§99).
  it('namespaces its nginx variable rather than defining a bare $unix', () => {
    expect(block).toContain('$crowdsec_unix');
    expect(block).not.toMatch(/\$unix\b/);
  });

  it('starts the stream puller in workers, not in the master init', () => {
    expect(block).toContain('init_worker_by_lua_block');
    expect(block).toContain('cs.SetupStream()');
  });
});

describe('replaceMarkedBlock', () => {
  const realIp = buildNpmRealIpBlock();
  const bouncer = buildNpmBouncerBlock();

  it('appends a block to a file that has none', () => {
    const out = replaceMarkedBlock('', NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    expect(out.trimEnd()).toBe(realIp.trimEnd());
  });

  it('keeps unmanaged content around the block it rewrites', () => {
    const hand = '# something an operator added\nclient_max_body_size 4000m;\n';
    const withBlock = replaceMarkedBlock(hand, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    expect(withBlock).toContain('client_max_body_size 4000m;');
    expect(withBlock).toContain(NPM_REALIP_MARKER_BEGIN);
  });

  it('replaces in place instead of appending a second copy', () => {
    const once = replaceMarkedBlock('', NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    const twice = replaceMarkedBlock(once, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    expect(twice.split(NPM_REALIP_MARKER_BEGIN)).toHaveLength(2);
    expect(twice).toBe(once);
  });

  // Turning enforcement off has to leave nginx with no Lua at all — a stale
  // block referencing a config file that is now deleted stops nginx starting.
  it('removes a block when passed null, leaving the other one intact', () => {
    let file = replaceMarkedBlock('', NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    file = replaceMarkedBlock(file, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, bouncer);
    expect(file).toContain('access_by_lua_block');

    const off = replaceMarkedBlock(file, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, null);
    expect(off).not.toContain('access_by_lua_block');
    expect(off).not.toContain(NPM_BOUNCER_MARKER_BEGIN);
    expect(off).toContain('set_real_ip_from 173.245.48.0/20;');
  });

  it('is a no-op when asked to remove a block that was never there', () => {
    const file = replaceMarkedBlock('', NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    expect(replaceMarkedBlock(file, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, null)).toBe(file);
  });

  it('round-trips off → on → off to the same file', () => {
    const base = replaceMarkedBlock('', NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    const on = replaceMarkedBlock(base, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, bouncer);
    const off = replaceMarkedBlock(on, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, null);
    expect(off).toBe(base);
  });
});

// Regression (§119): the two edits used to disagree about spacing — appending
// left a blank line, replacing in place left none — so every render rewrote
// the file and paid for another nginx config test. Found on the real stack,
// where enabling enforcement wrote http_top.conf twice in two seconds.
describe('replaceMarkedBlock idempotence', () => {
  const realIp = buildNpmRealIpBlock();
  const bouncer = buildNpmBouncerBlock();

  const render = (file: string, enforce: boolean): string => {
    let out = replaceMarkedBlock(file, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END, realIp);
    out = replaceMarkedBlock(out, NPM_BOUNCER_MARKER_BEGIN, NPM_BOUNCER_MARKER_END, enforce ? bouncer : null);
    return out;
  };

  it('reaches a fixed point on the second render, with enforcement on', () => {
    const first = render('', true);
    expect(render(first, true)).toBe(first);
    expect(render(render(first, true), true)).toBe(first);
  });

  it('reaches a fixed point with enforcement off', () => {
    const first = render('', false);
    expect(render(first, false)).toBe(first);
  });

  it('reaches the same file whether or not enforcement was ever on', () => {
    expect(render(render('', true), false)).toBe(render('', false));
  });

  it('is stable when starting from a file an operator has written in', () => {
    const hand = 'client_max_body_size 4000m;\n';
    const first = render(hand, true);
    expect(first).toContain('client_max_body_size 4000m;');
    expect(render(first, true)).toBe(first);
  });

  it('ends with exactly one newline and no leading blank lines', () => {
    const file = render('', true);
    expect(file.endsWith('\n')).toBe(true);
    expect(file.endsWith('\n\n')).toBe(false);
    expect(file.startsWith('\n')).toBe(false);
  });
});
