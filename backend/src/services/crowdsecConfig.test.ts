import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { __test } from './crowdsecConfig';

const { buildBouncerConfig, buildNpmRealIpBlock, NPM_REALIP_MARKER_BEGIN, NPM_REALIP_MARKER_END } = __test;

describe('buildBouncerConfig', () => {
  const cfg = buildBouncerConfig({
    lapiKey: 'lapi-key-123',
    accountId: 'acc-1',
    zoneId: 'zone-1',
    apiToken: 'cf-token-xyz',
  });

  it('points the bouncer at the agent over the compose network', () => {
    expect(cfg.crowdsec_lapi_url).toBe('http://crowdsec:8080/');
    expect(cfg.crowdsec_lapi_key).toBe('lapi-key-123');
  });

  it('nests the Cloudflare account, token and zone with a block action', () => {
    const account = cfg.cloudflare_config.accounts[0];
    expect(account.id).toBe('acc-1');
    expect(account.token).toBe('cf-token-xyz');
    expect(account.default_action).toBe('block');
    expect(account.zones).toEqual([{ zone_id: 'zone-1', actions: ['block'] }]);
  });

  it('serialises to valid YAML that round-trips', () => {
    const dumped = yaml.dump(cfg, { lineWidth: -1 });
    expect(yaml.load(dumped)).toEqual(cfg);
  });
});

describe('buildNpmRealIpBlock', () => {
  const block = buildNpmRealIpBlock();

  it('is marker-fenced so it can be rewritten in place', () => {
    expect(block.startsWith(NPM_REALIP_MARKER_BEGIN)).toBe(true);
    expect(block).toContain(NPM_REALIP_MARKER_END);
  });

  it('trusts Cloudflare ranges and reads the real client IP from CF-Connecting-IP', () => {
    expect(block).toContain('set_real_ip_from 173.245.48.0/20;');
    expect(block).toContain('set_real_ip_from 2400:cb00::/32;');
    expect(block).toContain('real_ip_header CF-Connecting-IP;');
    expect(block).toContain('real_ip_recursive on;');
  });
});
