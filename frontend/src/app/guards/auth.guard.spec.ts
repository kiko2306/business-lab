import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService } from '../core/auth.service';

describe('authGuard', () => {
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(() => {
    authService = jasmine.createSpyObj('AuthService', ['isAuthenticated', 'resolveProtectedRoute']);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: {} },
      ],
    });
  });

  function runGuard() {
    return TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));
  }

  it('allows navigation when authenticated', () => {
    authService.isAuthenticated.and.returnValue(true);

    expect(runGuard()).toBe(true);
    expect(authService.resolveProtectedRoute).not.toHaveBeenCalled();
  });

  it('defers to resolveProtectedRoute when not authenticated', () => {
    authService.isAuthenticated.and.returnValue(false);
    const resolved = of<true>(true);
    authService.resolveProtectedRoute.and.returnValue(resolved);

    expect(runGuard()).toBe(resolved);
    expect(authService.resolveProtectedRoute).toHaveBeenCalled();
  });
});
