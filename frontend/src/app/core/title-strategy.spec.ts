import { TestBed } from '@angular/core/testing';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { AppTitleStrategy } from './title-strategy';
import { TranslateService } from '../i18n/translate.service';

describe('AppTitleStrategy', () => {
  let strategy: AppTitleStrategy;
  let translate: TranslateService;

  const snapshotWithTitle = (title: string | undefined) =>
    ({ root: { firstChild: null }, title }) as unknown as RouterStateSnapshot;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: TitleStrategy, useClass: AppTitleStrategy }] });
    strategy = TestBed.inject(TitleStrategy) as AppTitleStrategy;
    translate = TestBed.inject(TranslateService);
    translate.setLocale('en');
    spyOn(strategy, 'buildTitle').and.callFake((snapshot: RouterStateSnapshot) => (snapshot as { title?: string }).title);
  });

  // Every route used to leave the tab, the history entry and the screen-reader
  // announcement on navigation reading "Business Lab" — nothing said which
  // page had loaded.
  it('names the page, then the product', () => {
    strategy.updateTitle(snapshotWithTitle('shell.nav.apps'));
    TestBed.flushEffects();
    expect(TestBed.inject(Title).getTitle()).toBe('Apps · Business Lab');
  });

  it('falls back to the product alone for a route with no title', () => {
    strategy.updateTitle(snapshotWithTitle(undefined));
    TestBed.flushEffects();
    expect(TestBed.inject(Title).getTitle()).toBe('Business Lab');
  });

  it('follows a language switch without a navigation', () => {
    strategy.updateTitle(snapshotWithTitle('shell.nav.apps'));
    translate.setLocale('pt-PT');
    TestBed.flushEffects();
    expect(TestBed.inject(Title).getTitle()).toBe('Aplicações · Business Lab');
  });
});
