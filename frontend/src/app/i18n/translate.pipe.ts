import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from './translate.service';

/**
 * `{{ 'shell.logout' | t }}`. Impure — a pure pipe memoizes on its own
 * arguments (the key string), not on `TranslateService.locale()`, so a
 * language switch would leave already-rendered bindings stale otherwise
 * (plan.md §597). App scale (~15 pages, no large lists) makes the
 * every-cycle re-check a non-issue.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.translate.t(key, params);
  }
}
