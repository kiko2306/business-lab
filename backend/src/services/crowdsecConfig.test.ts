import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { __test } from './crowdsecConfig';

const {
  buildBouncerConfig,
  buildNpmRealIpBlock,
  buildProfilesYaml,
  buildHttpNotificationYaml,
  NPM_REALIP_MARKER_BEGIN,
  NPM_REALIP_MARKER_END,
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
  const cfg = yaml.load(buildHttpNotificationYaml('http://host.docker.internal:10290/crowdsec-abc123')) as Record<
    string,
    unknown
  >;

  it('is the http_default plugin posting JSON to the given url', () => {
    expect(cfg.type).toBe('http');
    expect(cfg.name).toBe('http_default');
    expect(cfg.method).toBe('POST');
    expect(cfg.url).toBe('http://host.docker.internal:10290/crowdsec-abc123');
    expect((cfg.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('sends the raw alert list as JSON — unchanged whether the target is ntfy or n8n', () => {
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
