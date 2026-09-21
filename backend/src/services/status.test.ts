import { describe, expect, it } from 'vitest';
import { aggregateContainerState, healthProbeReachable, hostNetworkPortMappings, resolveAdditionalExposureUrls } from './status';
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
