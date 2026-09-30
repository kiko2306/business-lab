import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ServiceStateService } from './service-state.service';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api';

describe('ServiceStateService', () => {
  let service: ServiceStateService;
  let httpMock: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: jasmine.createSpyObj('AuthService', ['getAccessToken']) },
      ],
    });

    service = TestBed.inject(ServiceStateService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // Regression: this POST used to carry `retry({ count: 1, delay: 500 })`.
  // The backend behind it runs `docker compose up` plus every managed-config
  // reconciler — up to 15 minutes — and can fail *after* the container is
  // already running, so a retry fired the whole thing a second time on top
  // of the first one's side effects.
  it('does not retry a failed start', fakeAsync(() => {
    service.startService('paperless');

    httpMock
      .expectOne(`${API_BASE_URL}/services/paperless/start`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    // Past the 500ms the old retry operator waited.
    tick(1000);

    httpMock.expectNone(`${API_BASE_URL}/services/paperless/start`);
    expect(toast.error).toHaveBeenCalled();
  }));

  it('refreshes the service list after a successful start', fakeAsync(() => {
    service.startService('paperless');

    httpMock.expectOne(`${API_BASE_URL}/services/paperless/start`).flush({ message: 'Service started' });
    tick();

    httpMock.expectOne(`${API_BASE_URL}/services/status`).flush({
      services: [],
      summary: { total: 0, running: 0, stopped: 0, error: 0, starting: 0 },
      timestamp: new Date().toISOString(),
    });
    tick();

    expect(toast.success).toHaveBeenCalledWith('Service started');
  }));

  const emptyStatus = () => ({
    services: [],
    summary: { total: 0, running: 0, stopped: 0, error: 0, starting: 0 },
    timestamp: new Date().toISOString(),
  });

  // plan.md §769: dependencies start one at a time, in order, and the app itself
  // only after they all came up.
  it('starts a dependency chain in order, then the app', fakeAsync(() => {
    const svc = (name: string, state: 'running' | 'stopped', dependsOn?: string[]) =>
      ({ name, label: name, state, dependsOn }) as never;
    void service.startWithDependencies('app', [svc('app', 'stopped', ['auth']), svc('auth', 'stopped')]);

    httpMock.expectOne(`${API_BASE_URL}/services/auth/start`).flush({ message: 'ok' });
    tick();
    httpMock.expectNone(`${API_BASE_URL}/services/app/start`);
    httpMock.expectOne(`${API_BASE_URL}/services/status`).flush(emptyStatus());
    tick();
    httpMock.expectOne(`${API_BASE_URL}/services/app/start`).flush({ message: 'ok' });
    tick();
    httpMock.expectOne(`${API_BASE_URL}/services/status`).flush(emptyStatus());
    tick();
  }));

  it('stops the chain at the first failure and never starts the app', fakeAsync(() => {
    const svc = (name: string, state: 'running' | 'stopped', dependsOn?: string[]) =>
      ({ name, label: name, state, dependsOn }) as never;
    void service.startWithDependencies('app', [svc('app', 'stopped', ['auth']), svc('auth', 'stopped')]);

    httpMock.expectOne(`${API_BASE_URL}/services/auth/start`).flush({ message: 'boom' }, { status: 500, statusText: 'x' });
    tick(1000);
    httpMock.expectNone(`${API_BASE_URL}/services/app/start`);
  }));
});
