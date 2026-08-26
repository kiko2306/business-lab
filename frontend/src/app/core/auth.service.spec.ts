import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './api';
import { AuthResponse } from './models';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const authResponse: AuthResponse = {
    user: { id: 1, username: 'admin' },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  };

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [{ provide: Router, useValue: jasmine.createSpyObj('Router', ['navigateByUrl', 'parseUrl']) }],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('starts unauthenticated with no stored session', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
  });

  it('persists the session and becomes authenticated after a successful login', () => {
    service.login('admin', 'password').subscribe();

    const req = httpMock.expectOne(`${API_BASE_URL}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'password' });
    req.flush(authResponse);

    expect(service.isAuthenticated()).toBe(true);
    expect(service.getAccessToken()).toBe('access-token');
    expect(JSON.parse(localStorage.getItem('homelab.session')!)).toEqual(authResponse);
  });

  it('trims the username before sending it', () => {
    service.login('  admin  ', 'password').subscribe();

    const req = httpMock.expectOne(`${API_BASE_URL}/auth/login`);
    expect(req.request.body.username).toBe('admin');
    req.flush(authResponse);
  });

  it('clears the session on clearSession without navigating when asked not to', () => {
    service.login('admin', 'password').subscribe();
    httpMock.expectOne(`${API_BASE_URL}/auth/login`).flush(authResponse);
    expect(service.isAuthenticated()).toBe(true);

    service.clearSession(false);

    expect(service.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('homelab.session')).toBeNull();
  });

  it('reports no refresh token available before any login', () => {
    expect(service.hasRefreshToken()).toBe(false);
    service.refreshAccessToken().subscribe({
      error: (error) => expect(error.message).toBe('No refresh token available.'),
    });
  });
});
