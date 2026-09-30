import { startChain } from './start-chain';
import { ServiceStatus } from './models';

const svc = (name: string, state: ServiceStatus['state'], dependsOn?: string[]) =>
  ({ name, label: name, state, dependsOn }) as ServiceStatus;

describe('startChain', () => {
  it('lists stopped dependsOn apps, dependencies first, target excluded', () => {
    const all = [svc('app', 'stopped', ['b']), svc('b', 'stopped', ['c']), svc('c', 'stopped')];
    expect(startChain('app', all)).toEqual(['c', 'b']);
  });

  it('skips running apps and walks past them only when they are down', () => {
    const all = [svc('app', 'stopped', ['b', 'c']), svc('b', 'running', ['c']), svc('c', 'stopped')];
    expect(startChain('app', all)).toEqual(['c']);
  });

  it('is empty when everything needed is up, and survives a cycle', () => {
    expect(startChain('app', [svc('app', 'stopped', ['b']), svc('b', 'running')])).toEqual([]);
    const cyc = [svc('a', 'stopped', ['b']), svc('b', 'stopped', ['a'])];
    expect(startChain('a', cyc)).toEqual(['b']);
  });

  it('ignores a dependency missing from the registry', () => {
    expect(startChain('app', [svc('app', 'stopped', ['ghost'])])).toEqual([]);
  });
});
