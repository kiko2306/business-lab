import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { BehaviorSubject, Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { AuthResponse, LoginResult, Role, User, isMfaChallenge } from './models';
import { Capability, capabilitiesFor } from './capabilities';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly storageKey = 'homelab.session';

  private readonly session = this.readStoredSession();
  private readonly userSubject = new BehaviorSubject<User | null>(this.session.user);
  private readonly accessTokenSubject = new BehaviorSubject<string | null>(this.session.accessToken);
  private readonly refreshTokenSubject = new BehaviorSubject<string | null>(this.session.refreshToken);

  private refreshRequest$?: Observable<string>;

  readonly user$ = this.userSubject.asObservable();

  /** The signed-in user's roles, or `[]` when signed out. */
  readonly roles$ = this.userSubject.pipe(map((user) => user?.roles ?? []));

  /**
   * Effective dashboard capabilities for the signed-in account (plan.md §149,
   * §152). The backend puts an authoritative `capabilities` array on the
   * session; fall back to the optimistic role→capability constant only for a
   * session opened before §152 (no array yet).
   */
  readonly capabilities$ = this.userSubject.pipe(map((user) => this.capabilitySet(user)));

  /** Synchronous capability check for template/guard use. */
  hasCapability(capability: Capability): boolean {
    return this.capabilitySet(this.userSubject.value).has(capability);
  }

  private capabilitySet(user: User | null): Set<Capability> {
    if (user?.capabilities) {
      return new Set(user.capabilities as Capability[]);
    }
    return capabilitiesFor(user?.roles);
  }

  currentRoles(): Role[] {
    return this.userSubject.value?.roles ?? [];
  }

  login(username: string, password: string): Observable<LoginResult> {
    return this.http
      .post<LoginResult>(
        `${API_BASE_URL}/auth/login`,
        { username: username.trim(), password },
        {
          context: new HttpContext()
            .set(SKIP_AUTH, true)
            .set(SKIP_GLOBAL_ERROR_HANDLING, true),
        }
      )
      .pipe(
        tap((result) => {
          // A 202 MFA challenge carries no session — leave the caller to run
          // the second step. Only a full token pair is persisted.
          if (!isMfaChallenge(result)) {
            this.persistSession(result);
          }
        })
      );
  }

  /** Second step of a 2FA login: exchange the challenge token + a code for a session. */
  completeMfaLogin(mfaToken: string, code: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${API_BASE_URL}/auth/login/totp`,
        { mfaToken, code: code.trim() },
        {
          context: new HttpContext()
            .set(SKIP_AUTH, true)
            .set(SKIP_GLOBAL_ERROR_HANDLING, true),
        }
      )
      .pipe(tap((response) => this.persistSession(response)));
  }

  setup(username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${API_BASE_URL}/auth/setup`,
        { username: username.trim(), password },
        {
          context: new HttpContext()
            .set(SKIP_AUTH, true)
            .set(SKIP_GLOBAL_ERROR_HANDLING, true),
        }
      )
      .pipe(tap((response) => this.persistSession(response)));
  }

  logout(): void {
    const refreshToken = this.refreshTokenSubject.value;

    this.http
      .post(
        `${API_BASE_URL}/auth/logout`,
        { refreshToken },
        { context: new HttpContext().set(SKIP_GLOBAL_ERROR_HANDLING, true) }
      )
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.clearSession())
      )
      .subscribe();
  }

  refreshAccessToken(): Observable<string> {
    if (!this.refreshTokenSubject.value) {
      return throwError(() => new Error('No refresh token available.'));
    }

    if (!this.refreshRequest$) {
      this.refreshRequest$ = this.http
        .post<{ accessToken: string; roles?: Role[]; capabilities?: string[] }>(
          `${API_BASE_URL}/auth/refresh`,
          { refreshToken: this.refreshTokenSubject.value },
          {
            context: new HttpContext()
              .set(SKIP_AUTH, true)
              .set(SKIP_GLOBAL_ERROR_HANDLING, true),
          }
        )
        .pipe(
          tap((response) =>
            this.updateAccessToken(response.accessToken, response.roles, response.capabilities)
          ),
          map((response) => response.accessToken),
          finalize(() => {
            this.refreshRequest$ = undefined;
          }),
          shareReplay(1)
        );
    }

    return this.refreshRequest$;
  }

  isAuthenticated(): boolean {
    return Boolean(this.accessTokenSubject.value && this.userSubject.value);
  }

  hasRefreshToken(): boolean {
    return Boolean(this.refreshTokenSubject.value);
  }

  getAccessToken(): string | null {
    return this.accessTokenSubject.value;
  }

  /**
   * Whether the backend still has no admin account. Public wrapper over the
   * same `/auth/setup-status` probe the guards use — the login page reads it
   * to decide whether to offer the "create the initial administrator account"
   * link (the guest guard already redirects to /setup in that state, so on
   * /login this is normally false).
   */
  isSetupRequired(): Observable<boolean> {
    return this.checkSetupRequired();
  }

  resolveProtectedRoute(): Observable<true | UrlTree> {
    return this.checkSetupRequired().pipe(
      map((setupRequired) => (setupRequired ? this.router.parseUrl('/setup') : this.router.parseUrl('/login')))
    );
  }

  resolveGuestRoute(targetPath: string): Observable<true | UrlTree> {
    return this.checkSetupRequired().pipe(
      map((setupRequired) => {
        if (setupRequired && targetPath !== 'setup') {
          return this.router.parseUrl('/setup');
        }

        if (!setupRequired && targetPath === 'setup') {
          return this.router.parseUrl('/login');
        }

        return true;
      })
    );
  }

  clearSession(navigate = true): void {
    this.userSubject.next(null);
    this.accessTokenSubject.next(null);
    this.refreshTokenSubject.next(null);
    localStorage.removeItem(this.storageKey);

    if (navigate) {
      void this.router.navigateByUrl('/login');
    }
  }

  private checkSetupRequired(): Observable<boolean> {
    // Public endpoint: always 200, so a fresh (unauthenticated) page load no
    // longer logs a 401/503 to the console just to pick between /login and
    // /setup. Any unexpected failure falls back to "setup not required" so the
    // user still lands on the login screen.
    return this.http
      .get<{ setupRequired?: boolean }>(`${API_BASE_URL}/auth/setup-status`, {
        context: new HttpContext()
          .set(SKIP_AUTH, true)
          .set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(
        map((response) => response?.setupRequired === true),
        catchError(() => of(false))
      );
  }

  private persistSession(response: AuthResponse): void {
    this.userSubject.next(response.user);
    this.accessTokenSubject.next(response.accessToken);
    this.refreshTokenSubject.next(response.refreshToken);
    localStorage.setItem(this.storageKey, JSON.stringify(response));
  }

  private updateAccessToken(accessToken: string, roles?: Role[], capabilities?: string[]): void {
    const current = this.readStoredSession();
    // A refresh also re-reports the user's roles and effective capabilities —
    // fold them into the stored user so a session opened before §152 (or
    // across a role / feature change) picks up the new set without a full
    // re-login.
    const user =
      current.user && (roles || capabilities)
        ? {
            ...current.user,
            ...(roles ? { roles } : {}),
            ...(capabilities ? { capabilities } : {}),
          }
        : current.user;
    const updatedSession = {
      accessToken,
      refreshToken: current.refreshToken,
      user,
    };

    this.accessTokenSubject.next(accessToken);
    if (user !== current.user) {
      this.userSubject.next(user);
    }
    localStorage.setItem(this.storageKey, JSON.stringify(updatedSession));
  }

  private readStoredSession(): {
    accessToken: string | null;
    refreshToken: string | null;
    user: User | null;
  } {
    const stored = localStorage.getItem(this.storageKey);

    if (!stored) {
      return { accessToken: null, refreshToken: null, user: null };
    }

    try {
      const parsed = JSON.parse(stored) as Partial<AuthResponse>;
      return {
        accessToken: typeof parsed.accessToken === 'string' ? parsed.accessToken : null,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
        user: parsed.user ?? null,
      };
    } catch {
      return { accessToken: null, refreshToken: null, user: null };
    }
  }

}
