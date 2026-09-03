import { filterServices } from './apps.component';
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
