import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { AppBackupsPanelComponent } from './app-backups-panel.component';
import { ConfirmService } from '../../core/confirm.service';
import { OperationsService } from '../../core/operations.service';
import { ServiceStateService } from '../../core/service-state.service';
import { ToastService } from '../../core/toast.service';
import { TranslateService } from '../../i18n/translate.service';
import { AppBackupEntry, ServiceStatus } from '../../core/models';

const paperless: ServiceStatus = {
  name: 'paperless',
  label: 'Paperless',
  description: '',
  icon: '',
  state: 'running',
  healthy: true,
  lastChecked: '',
};

describe('AppBackupsPanelComponent', () => {
  let fixture: ComponentFixture<AppBackupsPanelComponent>;
  let component: AppBackupsPanelComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let state: jasmine.SpyObj<ServiceStateService>;

  const entry = (over: Partial<AppBackupEntry> = {}): AppBackupEntry => ({
    file: 'paperless-2026-01-01T00-00-00-000Z.tar.gz',
    bytes: 422_912,
    createdAt: '2026-01-01T00:00:00.000Z',
    manifest: { app: 'paperless', createdAt: '2026-01-01T00:00:00.000Z', dashboardVersion: '0.18.0', engine: 'postgres', archiveBytes: 422_912, dumps: [], dumpFailures: [] },
    ...over,
  });

  beforeEach(async () => {
    operations = jasmine.createSpyObj('OperationsService', [
      'listAppBackups',
      'createAppBackup',
      'restoreAppBackup',
      'deleteAppBackup',
      'downloadAppBackup',
    ]);
    operations.listAppBackups.and.returnValue(of({ items: [] }));
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    state = jasmine.createSpyObj('ServiceStateService', ['refresh']);

    await TestBed.configureTestingModule({
      imports: [AppBackupsPanelComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ServiceStateService, useValue: state },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).setLocale('en');

    fixture = TestBed.createComponent(AppBackupsPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('service', paperless);
  });

  it('loads the app\'s snapshots when it appears', () => {
    fixture.detectChanges();
    expect(operations.listAppBackups).toHaveBeenCalledWith('paperless');
  });

  it('summarises a snapshot as size · engine, and flags failed dumps', () => {
    expect(component['detail'](entry())).toBe('413 KB · postgres');
    expect(
      component['detail'](
        entry({ manifest: { ...entry().manifest!, dumpFailures: [{ target: '', kind: 'postgres', bytes: null, detail: 'x' }] } })
      )
    ).toBe('413 KB · postgres · 1 dump failed');
    expect(component['detail'](entry({ manifest: null }))).toBe('413 KB · details unavailable');
  });

  it('restores only after the user confirms, then refreshes the app state', async () => {
    confirm.ask.and.resolveTo(false);
    await component.restore(entry());
    expect(operations.restoreAppBackup).not.toHaveBeenCalled();

    confirm.ask.and.resolveTo(true);
    operations.restoreAppBackup.and.returnValue(of({ success: true, service: 'paperless', file: entry().file, fileRestore: '', databaseRestore: null, warnings: [], message: 'ok' }));
    await component.restore(entry());
    expect(operations.restoreAppBackup).toHaveBeenCalledWith('paperless', entry().file);
    expect(state.refresh).toHaveBeenCalled();
  });

  it('deletes only after the user confirms', async () => {
    confirm.ask.and.resolveTo(false);
    await component.remove(entry());
    expect(operations.deleteAppBackup).not.toHaveBeenCalled();
  });

  // OnPush: the list arrives from a subscription, so only a mark redraws it.
  it('shows snapshots that arrive late', () => {
    const pending = new Subject<{ items: AppBackupEntry[] }>();
    operations.listAppBackups.and.returnValue(pending as never);
    fixture.detectChanges();
    pending.next({ items: [entry()] });
    pending.complete();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).not.toContain('No snapshots yet');
    expect(el.querySelectorAll('li').length).toBe(1);
  });
});
