import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §937: Testar chave showed the backend's "Google API key verified." and
// Guardar chave its "API key saved." on a pt-PT page.
describe('Settings AI key row text', () => {
  let component: {
    aiKeyDrafts: Record<string, string>;
    aiKeyRowFeedback: Record<string, { type: string; message: string }>;
    testAiKey(provider: string): void;
    saveAiKey(provider: string): void;
  };
  let settings: jasmine.SpyObj<SettingsService>;

  beforeEach(async () => {
    settings = jasmine.createSpyObj('SettingsService', ['testAiKey', 'saveAiKey']);
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: SettingsService, useValue: settings },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: AuthService, useValue: { hasCapability: () => of(true) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setLocale('pt-PT');
    component = TestBed.createComponent(SettingsComponent).componentInstance as unknown as typeof component;
    component.aiKeyDrafts = { google: 'AIza-test' };
  });

  afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

  it('words a working key in the page language', () => {
    settings.testAiKey.and.returnValue(of({ success: true, message: 'Google API key verified.' }) as never);
    component.testAiKey('google');
    expect(component.aiKeyRowFeedback['google'].message).not.toContain('verified');
    expect(component.aiKeyRowFeedback['google'].message).toContain('chave');
  });

  it('keeps the provider\'s reason when a key is refused, under a translated lead', () => {
    settings.testAiKey.and.returnValue(of({ success: false, message: 'API key not valid.' }) as never);
    component.testAiKey('google');
    expect(component.aiKeyRowFeedback['google'].type).toBe('danger');
    expect(component.aiKeyRowFeedback['google'].message).toContain('API key not valid.');
    expect(component.aiKeyRowFeedback['google'].message).toContain('recusou');
  });

  it('words a saved key in the page language', () => {
    settings.saveAiKey.and.returnValue(of({ configured: true, keyMasked: 'AIza…test', message: 'API key saved.' }) as never);
    component.saveAiKey('google');
    expect(component.aiKeyRowFeedback['google'].message).not.toContain('saved');
  });
});
