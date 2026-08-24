import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { extractErrorMessage } from '../core/api';
import { SKIP_GLOBAL_ERROR_HANDLING } from '../core/http-context';
import { ToastService } from '../core/toast.service';

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (req.context.get(SKIP_GLOBAL_ERROR_HANDLING)) {
        return throwError(() => error);
      }

      if (error.status === 503 && error.error?.setupRequired) {
        toastService.info('Finish the initial administrator setup to continue.');
        void router.navigateByUrl('/setup');
        return throwError(() => error);
      }

      if (error.status === 0) {
        toastService.error('Unable to reach the backend API.');
      } else if (error.status >= 400 && error.status !== 401) {
        toastService.error(extractErrorMessage(error));
      }

      return throwError(() => error);
    })
  );
};
