import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { SKIP_AUTH } from '../core/http-context';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  if (req.context.get(SKIP_AUTH)) {
    return next(req);
  }

  const accessToken = authService.getAccessToken();
  const authorizedRequest = accessToken
    ? req.clone({
        setHeaders: {
          Authorization: 'Bearer ' + accessToken,
        },
      })
    : req;

  return next(authorizedRequest).pipe(
    catchError((error: HttpErrorResponse) => {
      const shouldRefresh =
        error.status === 401 &&
        !req.url.includes('/auth/') &&
        !req.headers.has('X-Auth-Retry') &&
        authService.hasRefreshToken();

      if (!shouldRefresh) {
        return throwError(() => error);
      }

      return authService.refreshAccessToken().pipe(
        switchMap((token) =>
          next(
            req.clone({
              setHeaders: {
                Authorization: 'Bearer ' + token,
                'X-Auth-Retry': '1',
              },
            })
          )
        ),
        catchError((refreshError) => {
          authService.clearSession();
          return throwError(() => refreshError);
        })
      );
    })
  );
};
