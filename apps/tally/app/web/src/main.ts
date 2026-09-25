import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt-PT';
import { LOCALE_ID } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { lang } from './app/i18n';

// Dates and currency follow the same language as the words; see i18n.ts.
registerLocaleData(localePt);
document.documentElement.lang = lang;

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideRouter(routes),
    { provide: LOCALE_ID, useValue: lang === 'pt-PT' ? 'pt-PT' : 'en-US' },
  ],
}).catch((err) => console.error(err));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
