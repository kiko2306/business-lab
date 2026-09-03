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

  it('parses a default that itself references another ${VAR:-default} (Home Page\'s allow-list)', () => {
    const vars = extractComposeEnvVars(
      'HOMEPAGE_ALLOWED_HOSTS: ${HOMEPAGE_ALLOWED_HOSTS:-localhost:${HOMEPAGE_PORT:-10190}}'
    );
    // A `[^}]*`-style default capture would stop at the inner `}`, leaving
    // the outer default truncated to `localhost:${HOMEPAGE_PORT`.
    expect(vars).toContainEqual({
      key: 'HOMEPAGE_ALLOWED_HOSTS',
      required: false,
      defaultValue: 'localhost:${HOMEPAGE_PORT:-10190}',
    });
    expect(vars).toContainEqual({ key: 'HOMEPAGE_PORT', required: false, defaultValue: '10190' });
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

  describe('a host-networked service (hostNetworkPort)', () => {
    // 'home-assistant' is the real registry entry carrying hostNetworkPort:
    // it runs with `network_mode: host` so its zeroconf/SSDP/DHCP discovery
    // can see the LAN, and host networking publishes nothing for the compose
    // parser to read.
    function writeHaCompose(content: string) {
      fs.mkdirSync(path.join(tmpDir, 'home-assistant'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'home-assistant', 'docker-compose.yml'), content);
    }

    it('returns the declared port even though the compose file publishes none', () => {
      writeHaCompose('services:\n  home-assistant:\n    network_mode: host\n');
      expect(getPublishedUpstreamPort('home-assistant')).toBe(8123);
    });

    it('still returns null when the app is not installed', () => {
      // The declaration says where an installed service listens, not that an
      // uninstalled one is exposable — exposure keys off this being null.
      expect(getPublishedUpstreamPort('home-assistant')).toBeNull();
    });

    it('leaves portEnvVar lookups to the compose file', () => {
      // An additionalExposures port names a published mapping, so it must
      // keep coming from the file rather than collapsing to the host port.
      writeHaCompose('services:\n  extra:\n    ports:\n      - "${EXTRA_PORT:-9123}:80"\n');
      expect(getPublishedUpstreamPort('home-assistant', 'EXTRA_PORT')).toBe(9123);
      expect(getPublishedUpstreamPort('home-assistant', 'MISSING_PORT')).toBeNull();
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

  it('returns the bare base domain for an apex exposure', () => {
    // The Home Page is served at the zone apex too (§111) — no subdomain, no
    // suffix, whatever the service name.
    expect(buildExposureHostname('homepage', 'example.com', undefined, { apex: true })).toBe('example.com');
  });
});

describe('homepage apex exposure', () => {
  it('declares an apex additionalExposures entry pointed at the Home Page port', () => {
    const apex = (SERVICES['homepage'].additionalExposures ?? []).find((extra) => extra.apex);
    expect(apex).toBeDefined();
    expect(apex?.suffix).toBeUndefined();
    expect(apex?.portEnvVar).toBe('HOMEPAGE_PORT');
  });
});

describe('generated secrets coverage', () => {
  // Principle 3: anything the system can derive, it must derive. A shipped
  // 'change-me' that nobody replaces is a silent misconfiguration — Authelia
  // simply refuses to start, NPM's database rejects its own credentials.
  it('generates every secret that does not have to come from outside', () => {
    const declared = (name: string) => [
      ...(SERVICES[name]?.autoGeneratedSecrets ?? []),
      ...(SERVICES[name]?.hiddenGeneratedSecrets ?? []),
    ];
    expect(declared('code-server')).toEqual(
      expect.arrayContaining(['CODE_SERVER_SUDO_PASSWORD', 'CODE_SERVER_PASSWORD'])
    );
    expect(declared('nginx-proxy-manager')).toEqual(
      expect.arrayContaining(['NPM_DB_PASSWORD', 'NPM_DB_ROOT_PASSWORD'])
    );
    expect(declared('pihole')).toContain('PIHOLE_WEB_PASSWORD');
    expect(declared('authelia')).toEqual(
      expect.arrayContaining(['AUTHELIA_SESSION_SECRET', 'AUTHELIA_JWT_SECRET'])
    );
  });

  it('does not pretend to generate a third-party credential', () => {
    // A Tailscale auth key comes from Tailscale; it cannot be invented. It is
    // prompted for by start.sh instead, which is the honest place for it.
    expect(declared_tailscale()).not.toContain('TAILSCALE_AUTH_KEY');
    function declared_tailscale() {
      return [
        ...(SERVICES['tailscale']?.autoGeneratedSecrets ?? []),
        ...(SERVICES['tailscale']?.hiddenGeneratedSecrets ?? []),
      ];
    }
  });
});

describe('home-assistant host networking', () => {
  const ha = SERVICES['home-assistant'];
  // Read the checked-in compose file directly (not via APPS_DIR, which other
  // suites here repoint at a temp root) so this guards the real coupling:
  // three files have to agree on 8123, and nothing else forces them to.
  const composeText = fs.readFileSync(
    path.resolve(__dirname, '../../..', ha.composePath),
    'utf8'
  );

  it('runs with host networking, which is what makes discovery work', () => {
    // zeroconf/mDNS, SSDP/UPnP and the DHCP sniffer all read broadcast and
    // multicast traffic that never crosses a Docker bridge. Put HA back on a
    // bridge and its "Discovered" section is permanently empty.
    expect(composeText).toMatch(/^\s*network_mode:\s*host\s*$/m);
  });

  it('publishes no port, because host networking cannot remap one', () => {
    expect(composeText).not.toMatch(/^\s*ports:\s*$/m);
  });

  it('declares the port it binds, so exposure and health checks can find it', () => {
    // With no ports: mapping there is nothing in the compose file to parse —
    // hostNetworkPort is the only thing pointing exposure at the right port.
    expect(ha.hostNetworkPort).toBe(8123);
    expect(composeText).toContain(`:${ha.hostNetworkPort}/manifest.json`);
    expect(ha.healthCheck.url).toContain(`:${ha.hostNetworkPort}/`);
  });
});

describe('dependency declarations', () => {
  const entries = Object.entries(SERVICES);

  it('only names services that exist in the registry', () => {
    for (const [name, service] of entries) {
      for (const dep of [...(service.dependsOn ?? []), ...(service.requires ?? [])]) {
        expect(SERVICES[dep], `${name} declares an unknown dependency: ${dep}`).toBeDefined();
      }
    }
  });

  it('never declares a service as its own dependency', () => {
    for (const [name, service] of entries) {
      expect([...(service.dependsOn ?? []), ...(service.requires ?? [])]).not.toContain(name);
    }
  });

  it('keeps dependsOn free of cycles, which would make both apps unstartable', () => {
    // Only the hard tier can deadlock: it is the one that blocks a start.
    const seen = new Set<string>();
    const visit = (name: string, trail: string[]): void => {
      if (trail.includes(name)) {
        throw new Error(`dependsOn cycle: ${[...trail, name].join(' -> ')}`);
      }
      if (seen.has(name)) {
        return;
      }
      seen.add(name);
      for (const dep of SERVICES[name]?.dependsOn ?? []) {
        visit(dep, [...trail, name]);
      }
    };
    expect(() => entries.forEach(([name]) => visit(name, []))).not.toThrow();
  });

  it('gates a start only on what actually stops the app booting', () => {
    // NetBird crash-loops without Authelia's OIDC provider, so that one blocks
    // the start. Tailscale (signal via Funnel) and NPM (its API + login
    // routes) break what it does, not whether it comes up — gating starts on
    // the proxy would mean nothing could be started while NPM is down.
    expect(SERVICES['netbird-vpn'].dependsOn).toEqual(['authelia']);
    expect(SERVICES['netbird-vpn'].requires).toEqual(
      expect.arrayContaining(['tailscale', 'nginx-proxy-manager'])
    );
    expect(SERVICES['netbird-vpn'].requires).not.toContain('authelia');
    // CrowdSec parses NPM's access logs; with NPM down it is healthy and idle.
    expect(SERVICES['crowdsec'].requires).toEqual(['nginx-proxy-manager']);
    expect(SERVICES['crowdsec'].dependsOn).toBeUndefined();
  });
});

// composePath is nominal — upstream projects name the file inconsistently, so
// the app directory is probed the same way resolveComposeFile does.
const composeText = (composePath: string) => {
  const dir = path.resolve(__dirname, '../../..', path.dirname(composePath));
  const found = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']
    .map((file) => path.join(dir, file))
    .find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error(`no compose file in ${dir}`);
  }
  return fs.readFileSync(found, 'utf8');
};

describe('Home Page discovery labels', () => {
  // homepageConfig.ts generates the Home Page's services.yaml from these
  // labels (name/group/icon/description) — a tile per running, exposed app
  // (plan.md §114). An app missing them would generate a broken or nameless
  // tile, so the labels stay mandatory for every app in the registry, checked
  // here rather than left to whoever reviews the next compose file.

  it('are carried by every app', () => {
    for (const [name, service] of Object.entries(SERVICES)) {
      const text = composeText(service.composePath);
      expect(text, `${name} has no homepage.name label`).toContain('homepage.name=');
      expect(text, `${name} has no homepage.group label`).toContain('homepage.group=');
    }
  });

  // An app flagged hideFromHomePage still needs the labels — the registry-wide
  // check above covers it, and the flag only suppresses the tile, not the
  // metadata (§131.2).
  it('are still required for an app that is hidden from the Home Page', () => {
    expect(SERVICES['onlyoffice'].hideFromHomePage).toBe(true);
    const text = composeText(SERVICES['onlyoffice'].composePath);
    expect(text).toContain('homepage.name=');
    expect(text).toContain('homepage.group=');
  });
});

describe('database backup coverage', () => {
  // An app whose compose file runs a database server needs a `backup:` entry,
  // or the scheduled dump skips it and the file backup copies its live data
  // files raw — which can restore corrupt, silently, and is only discovered
  // the day someone needs it.
  //
  // guacamole shipped without one (§88.6) and nothing caught it, which is why
  // this is a registry-wide rule rather than a review habit. onlyoffice is the
  // case this cannot see: its Postgres lives inside the documentserver image
  // rather than as its own compose service, so there is no image line to match.
  const DB_IMAGE = /^\s+image:.*(postgres|mariadb|mysql|percona)/im;

  it('declares a dump for every app that runs a database server', () => {
    for (const [name, service] of Object.entries(SERVICES)) {
      if (!DB_IMAGE.test(composeText(service.composePath))) {
        continue;
      }
      expect(
        service.backup,
        `${name} runs a database container but declares no backup: entry, so nothing dumps it`
      ).toBeDefined();
    }
  });

  it('names a compose service that the app actually defines', () => {
    for (const [name, service] of Object.entries(SERVICES)) {
      if (!service.backup) {
        continue;
      }
      // A typo here fails open: findContainer finds nothing and the dump is
      // reported as "not running — skipped", which counts as a success.
      expect(
        composeText(service.composePath),
        `${name} declares backup.service '${service.backup.service}', which is not a service in its compose file`
      ).toMatch(new RegExp(`^\\s+${service.backup.service}:\\s*$`, 'm'));
    }
  });
});
