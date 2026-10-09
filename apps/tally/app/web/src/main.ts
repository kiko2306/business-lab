import { registerLocaleData } from '@angular/common';
import localeEnIE from '@angular/common/locales/en-IE';
import localePt from '@angular/common/locales/pt-PT';
import { LOCALE_ID, provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { htmlLang } from './app/i18n';

// Dates and currency follow the same language as the words; see i18n.ts.
registerLocaleData(localePt);
registerLocaleData(localeEnIE);
document.documentElement.lang = htmlLang;

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),provideHttpClient(),
    provideRouter(routes),
    { provide: LOCALE_ID, useValue: htmlLang },
  ],
}).catch((err) => console.error(err));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
