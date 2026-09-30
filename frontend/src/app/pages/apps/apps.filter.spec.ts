import { en } from '../../i18n/en';
import { filterServices, hasIssue } from './apps.component';
import { ServiceStatus } from '../../core/models';

function svc(partial: Partial<ServiceStatus>): ServiceStatus {
  return {
    name: 'x',
    label: 'X',
    description: '',
    state: 'stopped',
    ...partial,
  } as ServiceStatus;
}

describe('filterServices', () => {
  const services = [
    svc({ name: 'jellyfin', label: 'Jellyfin', description: 'Home media server', category: 'Media' }),
    svc({ name: 'immich', label: 'Immich', description: 'Photo and video backup', category: 'Media' }),
    svc({ name: 'vaultwarden', label: 'Vaultwarden', description: 'Password manager', category: 'Networking & Security' }),
  ];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterServices(services, '')).toEqual(services);
    expect(filterServices(services, '   ')).toEqual(services);
  });

  it('matches on label case-insensitively', () => {
    expect(filterServices(services, 'JELLY').map((s) => s.name)).toEqual(['jellyfin']);
  });

  it('matches on description and category too', () => {
    expect(filterServices(services, 'password').map((s) => s.name)).toEqual(['vaultwarden']);
    expect(filterServices(services, 'media').map((s) => s.name)).toEqual(['jellyfin', 'immich']);
  });

  it('requires every space-separated term to match (AND)', () => {
    expect(filterServices(services, 'media photo').map((s) => s.name)).toEqual(['immich']);
    expect(filterServices(services, 'media nope')).toEqual([]);
  });
});

// plan.md §761: the summary tiles filter the list, and a category holding a
// failed app never hides it inside a collapsed group.
describe('filterServices by state', () => {
  const services = [
    svc({ name: 'a', label: 'A', state: 'error' }),
    svc({ name: 'b', label: 'B', state: 'stopped' }),
    svc({ name: 'c', label: 'C', state: 'running' }),
  ];

  it('narrows to one state, and combines with the text query', () => {
    expect(filterServices(services, '', 'error').map((s) => s.name)).toEqual(['a']);
    expect(filterServices(services, '', 'stopped').map((s) => s.name)).toEqual(['b']);
    expect(filterServices(services, 'c', 'stopped')).toEqual([]);
    expect(filterServices(services, '', null)).toEqual(services);
  });
});

describe('hasIssue', () => {
  it('is true for a group with any failed app', () => {
    expect(hasIssue([svc({ state: 'running' }), svc({ state: 'error' })])).toBeTrue();
    expect(hasIssue([svc({ state: 'stopped' })])).toBeFalse();
  });
});

describe('summary strip', () => {
  it('has no Total tile: the headline already says how many apps there are', () => {
    // template-level guard lives in apps-strings.spec (dictionary), so just pin the key set
    expect(Object.keys(en)).not.toContain('apps.summary.total');
  });
});
