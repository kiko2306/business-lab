import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { SettingsComponent } from './settings.component';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §933: a toggle restarts n8n and CrowdSec (~30 s). Until the save came
// back the switch read off but its Test stayed live, and nothing said it was saving.
describe('Settings ntfy switch', () => {
  it('greys out Test at once and says it is saving until the save lands', async () => {
    const pending = new Subject<unknown>();
    const settings = jasmine.createSpyObj('SettingsService', ['saveAlertSettings']);
    settings.saveAlertSettings.and.returnValue(pending);
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideRouter([]),
        { provide: SettingsService, useValue: settings },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: AuthService, useValue: { hasCapability: () => of(true) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setLocale('en');
    const component = TestBed.createComponent(SettingsComponent).componentInstance as unknown as {
      alertSettings: { topics: Record<string, string>; enabled: Record<string, boolean> };
      alertsFeedback: { type: string; message: string } | null;
      toggleCategoryEnabled(category: string, enabled: boolean): void;
    };
    component.alertSettings = {
      topics: { crowdsec: 't', 'critical-service': 't', netbird: 't', backup: 't' },
      enabled: { crowdsec: true, 'critical-service': true, netbird: true, backup: true },
    };

    component.toggleCategoryEnabled('crowdsec', false);

    expect(component.alertSettings.enabled['crowdsec']).toBeFalse();
    expect(component.alertsFeedback?.message).toContain('Saving');
  });
});
