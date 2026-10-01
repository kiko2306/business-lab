import { describe, expect, it } from 'vitest';
import {
  aggregateContainerState,
  groupExposureRows,
  healthProbeReachable,
  hostNetworkPortMappings,
  parseDockerPs,
  resolveAdditionalExposureUrls,
} from './status';
import { ServiceAdditionalExposure, ServiceExposureRow } from '../types';

describe('aggregateContainerState', () => {
  it('is unknown with no containers', () => {
    expect(aggregateContainerState([])).toBe('unknown');
  });

  it('is running when every container is running', () => {
    expect(aggregateContainerState(['running', 'running'])).toBe('running');
  });

  it('is running when the only non-running containers are one-shot exits', () => {
    // e.g. a migration container that exits 0 alongside the running app
    expect(aggregateContainerState(['running', 'running', 'exited'])).toBe('running');
  });

  it('is starting when a peer is still being created next to a running one', () => {
    expect(aggregateContainerState(['running', 'created'])).toBe('starting');
  });

  it('is error when any container is stuck restarting (crash loop)', () => {
    expect(aggregateContainerState(['restarting'])).toBe('error');
    expect(aggregateContainerState(['running', 'restarting'])).toBe('error');
  });

  it('is error when a container was created but nothing ever started (port clash)', () => {
    expect(aggregateContainerState(['created'])).toBe('error');
    expect(aggregateContainerState(['created', 'exited'])).toBe('error');
  });

  it('is stopped when every container has exited', () => {
    expect(aggregateContainerState(['exited', 'exited'])).toBe('stopped');
  });
});

describe('healthProbeReachable', () => {
  it('is true when the container publishes a host port', () => {
    expect(healthProbeReachable(8222, undefined)).toBe(true);
  });

  it('is true for a host-networked app that declares its port', () => {
    expect(healthProbeReachable(null, 8123)).toBe(true);
  });

  it('is false when there is no published port and no declared one', () => {
    // resolveHealthTarget would probe the container port on a host nothing is
    // listening on, so the check could only ever fail — skip it instead.
    expect(healthProbeReachable(null, undefined)).toBe(false);
  });
});

describe('hostNetworkPortMappings', () => {
  it('reports the declared port on both sides of the mapping', () => {
    // Host networking does not remap: the app binds the host's 8123 and that
    // is also the port inside the container, so the dashboard's ports table
    // shows a service that publishes nothing for `docker ps` to see.
    expect(hostNetworkPortMappings(8123)).toEqual([
      { hostPort: '8123', containerPort: '8123', protocol: 'tcp' },
    ]);
  });
});

describe('parseDockerPs', () => {
  const line = (project: string, state: string, ports = '') => `${project}\t${state}\t${ports}`;

  it('is empty for empty output', () => {
    expect(parseDockerPs('').size).toBe(0);
    expect(parseDockerPs('\n  \n').size).toBe(0);
  });

  it('groups every container by its compose project', () => {
    const snapshot = parseDockerPs(
      [line('vaultwarden', 'running'), line('vaultwarden', 'exited'), line('outline', 'running')].join('\n')
    );
    expect(snapshot.get('vaultwarden')?.states).toEqual(['running', 'exited']);
    expect(snapshot.get('outline')?.states).toEqual(['running']);
  });

  it('skips a container with no compose project label', () => {
    // Hand-run containers (docker run) have an empty label and belong to no app.
    expect(parseDockerPs(line('', 'running', '0.0.0.0:9000->9000/tcp')).size).toBe(0);
  });

  it('lowercases the state so aggregation sees a known value', () => {
    expect(parseDockerPs(line('outline', 'Running')).get('outline')?.states).toEqual(['running']);
  });

  it('collects published ports, deduplicated and sorted by host port', () => {
    const snapshot = parseDockerPs(
      [
        line('netbird-vpn', 'running', '0.0.0.0:10520->80/tcp, [::]:10520->80/tcp'),
        line('netbird-vpn', 'running', '0.0.0.0:10521->33073/tcp'),
      ].join('\n')
    );
    expect(snapshot.get('netbird-vpn')?.ports).toEqual([
      { hostPort: '10520', containerPort: '80', protocol: 'tcp' },
      { hostPort: '10521', containerPort: '33073', protocol: 'tcp' },
    ]);
  });

  it('reports a published port range', () => {
    const snapshot = parseDockerPs(line('nginx-proxy-manager', 'running', '0.0.0.0:80-81->80-81/tcp'));
    expect(snapshot.get('nginx-proxy-manager')?.ports).toEqual([
      { hostPort: '80-81', containerPort: '80-81', protocol: 'tcp' },
    ]);
  });

  it('ignores a container-only port with no host binding', () => {
    const snapshot = parseDockerPs(line('outline', 'running', '5432/tcp'));
    expect(snapshot.get('outline')?.ports).toEqual([]);
  });

  it('ignores the ports of a container that is not running', () => {
    // A single `docker ps -a` answers both questions, but a stopped
    // container's stale mapping is not bound to anything on the host.
    const snapshot = parseDockerPs(line('outline', 'exited', '0.0.0.0:10620->3000/tcp'));
    expect(snapshot.get('outline')?.ports).toEqual([]);
  });
});

describe('groupExposureRows', () => {
  const row = (service_name: string) => ({ service_name }) as ServiceExposureRow;

  it('splits primary rows from their secondary hostnames', () => {
    const grouped = groupExposureRows([row('netbird-vpn'), row('netbird-vpn:api'), row('homepage:apex')]);
    expect(grouped.primary.get('netbird-vpn')).toEqual(row('netbird-vpn'));
    expect(grouped.primary.has('netbird-vpn:api')).toBe(false);
    expect(grouped.secondary.get('netbird-vpn')).toEqual([row('netbird-vpn:api')]);
    // A secondary row with no primary row of its own still groups under its parent.
    expect(grouped.secondary.get('homepage')).toEqual([row('homepage:apex')]);
  });

  it('is empty maps for no rows', () => {
    const grouped = groupExposureRows([]);
    expect(grouped.primary.size).toBe(0);
    expect(grouped.secondary.size).toBe(0);
  });
});

describe('resolveAdditionalExposureUrls', () => {
  function row(overrides: Partial<ServiceExposureRow> = {}): ServiceExposureRow {
    return {
      service_name: 'netbird-vpn:api',
      enabled: true,
      hostname: 'netbird-vpn-api.example.com',
      upstream_scheme: 'http',
      upstream_host: null,
      upstream_port: null,
      websocket: true,
      npm_host_id: null,
      cf_hostname_id: null,
      status: 'provisioned',
      last_error: null,
      updated_at: new Date(),
      ...overrides,
    };
  }

  const managementApi: ServiceAdditionalExposure = {
    suffix: 'api',
    label: 'Management API',
    portEnvVar: 'NETBIRD_MGMT_PORT',
    grpc: true,
  };

  it('is empty when the service declares no additionalExposures', () => {
    expect(resolveAdditionalExposureUrls(undefined, [row()])).toEqual([]);
  });

  it('matches a live secondary row to its declared label by suffix', () => {
    expect(resolveAdditionalExposureUrls([managementApi], [row()])).toEqual([
      { label: 'Management API', hostname: 'netbird-vpn-api.example.com' },
    ]);
  });

  it('matches an apex entry by the literal "apex" key', () => {
    const apexExtra: ServiceAdditionalExposure = { apex: true, label: 'Bare domain', portEnvVar: 'HOMEPAGE_PORT' };
    const apexRow = row({ service_name: 'homepage:apex', hostname: 'example.com' });
    expect(resolveAdditionalExposureUrls([apexExtra], [apexRow])).toEqual([
      { label: 'Bare domain', hostname: 'example.com' },
    ]);
  });

  it('omits an entry with no row yet (not provisioned)', () => {
    expect(resolveAdditionalExposureUrls([managementApi], [])).toEqual([]);
  });

  it('omits a row that is disabled, still provisioning, or has no hostname', () => {
    expect(resolveAdditionalExposureUrls([managementApi], [row({ enabled: false })])).toEqual([]);
    expect(resolveAdditionalExposureUrls([managementApi], [row({ status: 'not_provisioned' })])).toEqual([]);
    expect(resolveAdditionalExposureUrls([managementApi], [row({ hostname: null })])).toEqual([]);
  });
});
