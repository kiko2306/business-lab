import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { of } from 'rxjs';
import { guestGuard } from './guest.guard';
import { AuthService } from '../core/auth.service';

describe('guestGuard', () => {
  let authService: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  const menuTree = {} as UrlTree;

  beforeEach(() => {
    authService = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'resolveGuestRoute']);
    router = jasmine.createSpyObj('Router', ['parseUrl']);
    router.parseUrl.and.returnValue(menuTree);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    });
  });

  function runGuard(path: string) {
    const route = { routeConfig: { path } } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => guestGuard(route, {} as never));
  }

  it('redirects to the menu when already authenticated', () => {
    authService.isAuthenticated.and.returnValue(true);

    expect(runGuard('login')).toBe(menuTree);
    expect(router.parseUrl).toHaveBeenCalledWith('/home');
    expect(authService.resolveGuestRoute).not.toHaveBeenCalled();
  });

  it('defers to resolveGuestRoute with the requested path when not authenticated', () => {
    authService.isAuthenticated.and.returnValue(false);
    const resolved = of<true>(true);
    authService.resolveGuestRoute.and.returnValue(resolved);

    expect(runGuard('setup')).toBe(resolved);
    expect(authService.resolveGuestRoute).toHaveBeenCalledWith('setup');
  });

  it('falls back to "login" when the route has no configured path', () => {
    authService.isAuthenticated.and.returnValue(false);
    authService.resolveGuestRoute.and.returnValue(of<true>(true));

    const route = { routeConfig: null } as ActivatedRouteSnapshot;
    TestBed.runInInjectionContext(() => guestGuard(route, {} as never));

    expect(authService.resolveGuestRoute).toHaveBeenCalledWith('login');
  });
});
