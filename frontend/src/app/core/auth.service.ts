import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { BehaviorSubject, Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { API_BASE_URL } from './api';
import { SKIP_AUTH, SKIP_GLOBAL_ERROR_HANDLING } from './http-context';
import { AuthResponse, User } from './models';

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

  login(username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${API_BASE_URL}/auth/login`,
        { username: username.trim(), password },
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
        .post<{ accessToken: string }>(
          `${API_BASE_URL}/auth/refresh`,
          { refreshToken: this.refreshTokenSubject.value },
          {
            context: new HttpContext()
              .set(SKIP_AUTH, true)
              .set(SKIP_GLOBAL_ERROR_HANDLING, true),
          }
        )
        .pipe(
          map((response) => response.accessToken),
          tap((accessToken) => this.updateAccessToken(accessToken)),
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
    return this.http
      .get(`${API_BASE_URL}`, {
        context: new HttpContext()
          .set(SKIP_AUTH, true)
          .set(SKIP_GLOBAL_ERROR_HANDLING, true),
      })
      .pipe(
        map(() => false),
        catchError((error: HttpErrorResponse) => {
          if (error.status === 503 && error.error?.setupRequired) {
            return of(true);
          }

          if (error.status === 401) {
            return of(false);
          }

          return of(false);
        })
      );
  }

  private persistSession(response: AuthResponse): void {
    this.userSubject.next(response.user);
    this.accessTokenSubject.next(response.accessToken);
    this.refreshTokenSubject.next(response.refreshToken);
    localStorage.setItem(this.storageKey, JSON.stringify(response));
  }

  private updateAccessToken(accessToken: string): void {
    const current = this.readStoredSession();
    const updatedSession = {
      accessToken,
      refreshToken: current.refreshToken,
      user: current.user,
    };

    this.accessTokenSubject.next(accessToken);
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
