import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVICES, buildExposureHostname, extractComposeEnvVars, getPublishedUpstreamPort } from './services';

describe('extractComposeEnvVars', () => {
  it('treats a bare ${VAR} as required', () => {
    const vars = extractComposeEnvVars('PASSWORD: ${PAPERLESS_DB_PASSWORD}');
    expect(vars).toEqual([{ key: 'PAPERLESS_DB_PASSWORD', required: true, defaultValue: null }]);
  });

  it('treats ${VAR:-default} as optional with the given default', () => {
    const vars = extractComposeEnvVars('PORT: ${PAPERLESS_PORT:-8000}');
    expect(vars).toEqual([{ key: 'PAPERLESS_PORT', required: false, defaultValue: '8000' }]);
  });

  it('dedupes repeated keys and stays required if any occurrence lacks a default', () => {
    const content = `
      DBNAME: \${PAPERLESS_DB_NAME:-paperless}
      POSTGRES_DB: \${PAPERLESS_DB_NAME}
    `;
    const vars = extractComposeEnvVars(content);
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ key: 'PAPERLESS_DB_NAME', required: true, defaultValue: 'paperless' });
  });

  it('allows an empty default', () => {
    const vars = extractComposeEnvVars('FOO: ${FOO:-}');
    expect(vars).toEqual([{ key: 'FOO', required: false, defaultValue: '' }]);
  });

  it('returns nothing for compose content with no variable references', () => {
    expect(extractComposeEnvVars('image: postgres:16-alpine')).toEqual([]);
  });
});

describe('getPublishedUpstreamPort', () => {
  // 'paperless' is a real registry entry whose app directory (basename of
  // its configured composePath) is 'paperless'; pointing APPS_DIR at a temp
  // root and writing a compose file under <tmp>/paperless/ lets
  // resolveComposeFile() find it without touching the checked-in fixtures
  // under apps/, which this test doesn't want to depend on staying in sync.
  let tmpDir: string;
  let originalAppsDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'services-test-'));
    fs.mkdirSync(path.join(tmpDir, 'paperless'));
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

  function writeCompose(content: string) {
    fs.writeFileSync(path.join(tmpDir, 'paperless', 'compose.yaml'), content);
  }

  it('reads a literal host port', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "8000:8000"\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(8000);
  });

  it('falls back to the ${VAR:-default} value when no .env overrides it', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "${PAPERLESS_PORT:-8000}:8000"\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(8000);
  });

  it('prefers the app .env value over the compose default', () => {
    writeCompose('services:\n  app:\n    ports:\n      - "${PAPERLESS_PORT:-8000}:8000"\n');
    fs.writeFileSync(path.join(tmpDir, 'paperless', '.env'), 'PAPERLESS_PORT=9001\n');
    expect(getPublishedUpstreamPort('paperless')).toBe(9001);
  });

  it('returns null when the compose file has no ports mapping', () => {
    writeCompose('services:\n  app:\n    image: paperless\n');
    expect(getPublishedUpstreamPort('paperless')).toBeNull();
  });

  it('returns null for a service with no installed compose file', () => {
    fs.rmSync(path.join(tmpDir, 'paperless'), { recursive: true, force: true });
    expect(getPublishedUpstreamPort('paperless')).toBeNull();
  });

  it('returns null for a name not in the registry', () => {
    expect(getPublishedUpstreamPort('not-a-real-service')).toBeNull();
  });

  describe('with a portEnvVar (multi-port apps, e.g. additionalExposures)', () => {
    it('picks the port mapping matching that specific env var, not the first one in the file', () => {
      writeCompose(
        'services:\n' +
          '  dashboard:\n' +
          '    ports:\n' +
          '      - "${DASH_PORT:-8081}:80"\n' +
          '  api:\n' +
          '    ports:\n' +
          '      - "${API_PORT:-8080}:8080"\n'
      );
      expect(getPublishedUpstreamPort('paperless', 'API_PORT')).toBe(8080);
      expect(getPublishedUpstreamPort('paperless', 'DASH_PORT')).toBe(8081);
      // Unqualified call still keeps its old "first port in file" behavior.
      expect(getPublishedUpstreamPort('paperless')).toBe(8081);
    });

    it('respects an app .env override for that specific var', () => {
      writeCompose(
        'services:\n' +
          '  dashboard:\n' +
          '    ports:\n' +
          '      - "${DASH_PORT:-8081}:80"\n' +
          '  api:\n' +
          '    ports:\n' +
          '      - "${API_PORT:-8080}:8080"\n'
      );
      fs.writeFileSync(path.join(tmpDir, 'paperless', '.env'), 'API_PORT=9999\n');
      expect(getPublishedUpstreamPort('paperless', 'API_PORT')).toBe(9999);
    });

    it('returns null when no port mapping uses that env var', () => {
      writeCompose('services:\n  app:\n    ports:\n      - "${DASH_PORT:-8081}:80"\n');
      expect(getPublishedUpstreamPort('paperless', 'API_PORT')).toBeNull();
    });

    it('picks the web port over earlier non-web ports on the same service, given its env var (pihole-shaped)', () => {
      // Regression: pihole publishes DNS (53/tcp, 53/udp) before its web
      // port on the *same* service block — "first port in the file" (the
      // unqualified call) picks DNS, which is why exposure needs
      // exposurePortEnvVar for it (see services.ts).
      writeCompose(
        'services:\n' +
          '  pihole:\n' +
          '    ports:\n' +
          '      - "${PIHOLE_DNS_PORT:-53}:53/tcp"\n' +
          '      - "${PIHOLE_DNS_PORT:-53}:53/udp"\n' +
          '      - "${PIHOLE_WEB_PORT:-8080}:80/tcp"\n'
      );
      expect(getPublishedUpstreamPort('paperless')).toBe(53);
      expect(getPublishedUpstreamPort('paperless', 'PIHOLE_WEB_PORT')).toBe(8080);
    });

    it('picks the web port over an earlier SERVICE that publishes one (netbird-shaped)', () => {
      // Regression: netbird-vpn's signal container is declared first in its
      // compose file and gained a published port when signal was exposed for
      // remote peers. "First port in the file" then resolved to signal's,
      // silently pointing the primary hostname at a gRPC service — which
      // answers a browser GET with `invalid gRPC request method "GET"`.
      // Hence exposurePortEnvVar on netbird-vpn in services.ts.
      writeCompose(
        'services:\n' +
          '  netbird-vpn:\n' +
          '    ports:\n' +
          '      - "${NETBIRD_SIGNAL_PORT:-8086}:80"\n' +
          '  netbird-dashboard:\n' +
          '    ports:\n' +
          '      - "${NETBIRD_DASHBOARD_PORT:-8081}:80"\n' +
          '  netbird-management:\n' +
          '    ports:\n' +
          '      - "${NETBIRD_MGMT_PORT:-8080}:80"\n'
      );
      expect(getPublishedUpstreamPort('paperless')).toBe(8086);
      expect(getPublishedUpstreamPort('paperless', 'NETBIRD_DASHBOARD_PORT')).toBe(8081);
      expect(getPublishedUpstreamPort('paperless', 'NETBIRD_MGMT_PORT')).toBe(8080);
      expect(getPublishedUpstreamPort('paperless', 'NETBIRD_SIGNAL_PORT')).toBe(8086);
    });
  });
});

describe('netbird-vpn exposures', () => {
  const netbird = SERVICES['netbird-vpn'];

  it('exposes the management API and the relay', () => {
    const suffixes = (netbird.additionalExposures ?? []).map((e) => e.suffix);
    expect(suffixes).toContain('api');
    expect(suffixes).toContain('relay');
  });

  it('does NOT expose signal through the tunnel', () => {
    // Regression guard, not a style preference. Signal registers a peer by
    // replying with response HEADERS on a gRPC stream that then stays open,
    // and Cloudflare never flushes headers while a stream is open — verified
    // on both the http2 and quic transports, so no connector setting fixes
    // it (plan.md §52). Signal is published over Tailscale Funnel instead
    // (NETBIRD_SIGNAL_HOSTNAME -> Signal.URI, written by start.sh).
    //
    // Re-adding it here would provision a perfectly healthy-looking NPM host
    // + tunnel ingress + DNS record that silently never works, which is
    // exactly how this cost several sessions to diagnose.
    const suffixes = (netbird.additionalExposures ?? []).map((e) => e.suffix);
    expect(suffixes).not.toContain('signal');
  });

  it('keeps the primary hostname pinned to the dashboard port', () => {
    // The signal container is declared first in the compose file and does
    // publish a port, so "first port in the file" would resolve to it.
    expect(netbird.exposurePortEnvVar).toBe('NETBIRD_DASHBOARD_PORT');
  });
});

describe('buildExposureHostname', () => {
  it('defaults to <service>.<base domain>', () => {
    expect(buildExposureHostname('immich', 'example.com')).toBe('immich.example.com');
  });

  it('honours exposureSubdomain when the service sets one', () => {
    // The browser terminal is implemented with wetty but must always be
    // published at ssh.<domain> — the address is what a person types, the
    // service name is internal identity.
    expect(SERVICES['wetty'].exposureSubdomain).toBe('ssh');
    expect(buildExposureHostname('wetty', 'example.com')).toBe('ssh.example.com');
  });

  it('stems additionalExposures from the same subdomain', () => {
    expect(buildExposureHostname('netbird-vpn', 'example.com', 'api')).toBe('netbird-vpn-api.example.com');
    expect(buildExposureHostname('wetty', 'example.com', 'x')).toBe('ssh-x.example.com');
  });

  it('falls back to the service name for an unknown service', () => {
    expect(buildExposureHostname('not-a-service', 'example.com')).toBe('not-a-service.example.com');
  });
});
