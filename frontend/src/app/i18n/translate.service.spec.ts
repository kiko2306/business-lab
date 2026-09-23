import { TestBed } from '@angular/core/testing';
import { TranslateService } from './translate.service';

describe('TranslateService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function freshService(): TranslateService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(TranslateService);
  }

  it('defaults to English with no stored preference', () => {
    expect(freshService().locale()).toBe('en');
  });

  it('substitutes params into a translated string', () => {
    expect(freshService().t('shell.signedInAs', { username: 'mig' })).toBe('Signed in as mig');
  });

  it('falls back to the key itself when no translation exists in any locale', () => {
    expect(freshService().t('does.not.exist')).toBe('does.not.exist');
  });

  it('persists the chosen locale across service instances', () => {
    freshService().setLocale('pt-PT');
    expect(localStorage.getItem('locale')).toBe('pt-PT');
    expect(freshService().locale()).toBe('pt-PT');
  });

  it('translates once the locale is switched', () => {
    const service = freshService();
    service.setLocale('pt-PT');
    expect(service.t('shell.logout')).toBe('Terminar sessão');
  });

  it('updates document.documentElement.lang on locale change', () => {
    freshService().setLocale('pt-PT');
    expect(document.documentElement.lang).toBe('pt-PT');
  });
});
