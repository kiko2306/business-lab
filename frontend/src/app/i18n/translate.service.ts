import { Injectable, signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';
import { en } from './en';
import { ptPT } from './pt-pt';

export type Locale = 'en' | 'pt-PT';

const DICTIONARIES: Record<Locale, Record<string, string>> = { en, 'pt-PT': ptPT };
const STORAGE_KEY = 'locale';

// `@angular/common/locales/pt` ships registered as 'pt' (European Portuguese
// — pt-BR is a separate file); re-registering it under 'pt-PT' lets the
// `date`/`number` pipes take `translate.locale()` directly as their locale
// argument (plan.md §597).
registerLocaleData(localePt, 'pt-PT');

function detectInitialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'pt-PT') {
    return stored;
  }
  return navigator.language.toLowerCase().startsWith('pt') ? 'pt-PT' : 'en';
}

@Injectable({ providedIn: 'root' })
export class TranslateService {
  readonly locale = signal<Locale>(detectInitialLocale());

  constructor() {
    document.documentElement.lang = this.locale();
  }

  /** Looks up `key` in the active dictionary, then `en`, then the key itself — the UI is never blank for an unmigrated page (plan.md §597). */
  t(key: string, params?: Record<string, string | number>): string {
    let value = DICTIONARIES[this.locale()][key] ?? en[key] ?? key;
    if (params) {
      for (const [name, replacement] of Object.entries(params)) {
        value = value.replace(`{{${name}}}`, String(replacement));
      }
    }
    return value;
  }

  setLocale(locale: Locale): void {
    this.locale.set(locale);
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }
}
