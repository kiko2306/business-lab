import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '../i18n/translate.service';

const PRODUCT = 'Business Lab';

/**
 * Sets the document title from each route's `title`, which is an i18n key
 * rather than finished text. Without this every route read "Business Lab":
 * the browser tab, the history entry and the announcement a screen reader
 * makes on navigation all said the same thing, so nothing told the user which
 * page had loaded (WCAG 2.4.2).
 *
 * The last key is kept so a language switch — which changes no route —
 * retitles the page too.
 */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private readonly key = signal<string | undefined>(undefined);

  constructor() {
    super();
    effect(() => {
      const key = this.key();
      this.title.setTitle(key ? `${this.translate.t(key)} · ${PRODUCT}` : PRODUCT);
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key.set(this.buildTitle(snapshot));
  }
}
