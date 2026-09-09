import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { Capability } from '../core/capabilities';

/**
 * Route guard: bounce to the menu unless the signed-in user's roles grant
 * `capability` (plan.md §149). The nav already hides these links; this catches
 * a typed-in or bookmarked URL so the page doesn't render a wall of 403
 * toasts. The backend is still the real gate.
 */
export function requireCapability(capability: Capability): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return auth.hasCapability(capability) ? true : router.parseUrl('/home');
  };
}

/** Like `requireCapability`, but any one of `capabilities` is enough — e.g.
 *  Settings holds both `settings:manage` panels and the `exposure:settings`
 *  networking panel (§331 slice 4). */
export function requireAnyCapability(...capabilities: Capability[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    return capabilities.some((c) => auth.hasCapability(c)) ? true : router.parseUrl('/home');
  };
}
