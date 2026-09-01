import { describe, expect, it } from 'vitest';
import { aggregateContainerState, hostNetworkPortMappings } from './status';

describe('aggregateContainerState', () => {
  it('is unknown with no containers', () => {
    expect(aggregateContainerState([])).toBe('unknown');
  });

  it('is running when every container is running', () => {
    expect(aggregateContainerState(['running', 'running'])).toBe('running');
  });

  it('is running when the only non-running containers are one-shot exits', () => {
    // e.g. beszel: an init container that exits 0 alongside the running app
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
