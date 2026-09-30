import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NetworkSettingsComponent } from './network-settings.component';
import { CloudflareSettings, ExposureSettings } from '../../core/models';
import { SettingsService } from '../../core/settings.service';
import { ToastService } from '../../core/toast.service';

const exposure: ExposureSettings = {
  configured: true,
  baseDomain: 'example.com',
  npmApiUrl: 'http://172.17.0.1:81',
  npmEmail: 'admin@example.com',
  npmPasswordConfigured: true,
  cloudflareAccountId: 'a'.repeat(32),
  cloudflareZoneId: 'z'.repeat(32),
  cloudflareTunnelId: 'tunnel-1',
};

// plan.md §785: the account and zone IDs follow from the token and the domain, so
// Settings does not ask for them. Blank means "look it up again on save", which is
// what keeps a changed domain from carrying the old zone along.
describe('NetworkSettingsComponent exposure form', () => {
  let fixture: ComponentFixture<NetworkSettingsComponent>;
  let component: NetworkSettingsComponent;
  let settings: jasmine.SpyObj<SettingsService>;

  beforeEach(async () => {
    // SectionCollapseService persists panel state to localStorage; start each
    // test with the panel at its collapsed-by-default state.
    localStorage.clear();

    settings = jasmine.createSpyObj('SettingsService', ['loadCloudflareSettings', 'loadExposureSettings', 'saveExposureSettings']);
    settings.loadCloudflareSettings.and.returnValue(of({ configured: true } as unknown as CloudflareSettings));
    settings.loadExposureSettings.and.returnValue(of(exposure));
    settings.saveExposureSettings.and.returnValue(of({ message: 'Saved' }));
    await TestBed.configureTestingModule({
      imports: [NetworkSettingsComponent],
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NetworkSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('leaves the override fields blank after loading, so a changed domain is looked up afresh', () => {
    const form = component['exposureForm'];
    expect(form.controls.baseDomain.value).toBe('example.com');
    expect(form.controls.cloudflareAccountId.value).toBe('');
    expect(form.controls.cloudflareZoneId.value).toBe('');
  });

  it('saves without the account and zone when they were not typed', () => {
    component['saveExposure']();
    const payload = settings.saveExposureSettings.calls.mostRecent().args[0];
    expect(payload.baseDomain).toBe('example.com');
    expect(payload.cloudflareTunnelId).toBe('tunnel-1');
    expect('cloudflareAccountId' in payload).toBeFalse();
    expect('cloudflareZoneId' in payload).toBeFalse();
  });

  it('sends an override that was typed, trimmed', () => {
    component['exposureForm'].patchValue({ cloudflareZoneId: ` ${'y'.repeat(32)} ` });
    component['saveExposure']();
    expect(settings.saveExposureSettings.calls.mostRecent().args[0].cloudflareZoneId).toBe('y'.repeat(32));
  });

  it('shows what was found, read-only, under Advanced', () => {
    // The exposure panel (the second `<app-panel>` on this page, after the
    // Cloudflare token one) is collapsed by default — expand it first.
    const host = fixture.nativeElement as HTMLElement;
    host.querySelectorAll<HTMLElement>('.panel__toggle')[1]?.click();
    fixture.detectChanges();

    const advanced = host.querySelector('details.exposure-advanced');
    expect(advanced).not.toBeNull();
    expect(advanced?.textContent).toContain('a'.repeat(32));
    expect(advanced?.textContent).toContain('z'.repeat(32));
  });
});
