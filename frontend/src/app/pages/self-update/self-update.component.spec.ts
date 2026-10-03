import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { SelfUpdateComponent } from './self-update.component';
import { OperationsService } from '../../core/operations.service';
import { ConfirmService } from '../../core/confirm.service';
import { ToastService } from '../../core/toast.service';
import { SelfUpdateRun, SelfUpdateStatus } from '../../core/models';
import { TranslateService } from '../../i18n/translate.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';

describe('SelfUpdateComponent', () => {
  let fixture: ComponentFixture<SelfUpdateComponent>;
  let component: SelfUpdateComponent;
  let operations: jasmine.SpyObj<OperationsService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;

  const upToDateStatus: SelfUpdateStatus = {
    appVersion: '0.24.0',
    check: { currentCommit: 'abc123def456', remoteCommit: 'abc123def456', commitsBehind: 0, checkedAt: new Date().toISOString(), branch: 'main' },
    lastCheckError: null,
    latestRun: null,
  };
  const behindStatus: SelfUpdateStatus = {
    appVersion: '0.24.0',
    check: { currentCommit: 'old111old111', remoteCommit: 'new222new222', commitsBehind: 2, checkedAt: new Date().toISOString(), branch: 'main' },
    lastCheckError: null,
    latestRun: null,
  };
  const runningRun: SelfUpdateRun = {
    id: 1,
    state: 'building',
    fromCommit: 'old111old111',
    toCommit: null,
    errorMessage: null,
    detail: null,
    failedPhase: null,
    appsFailed: [],
    startedAt: '2026-09-04T10:01:00.000Z',
    finishedAt: null,
  };

  beforeEach(async () => {
    // SectionCollapseService persists panel state to localStorage; start each
    // test with the panel at its collapsed-by-default state.
    localStorage.clear();

    operations = jasmine.createSpyObj('OperationsService', [
      'getSelfUpdateStatus',
      'checkForSelfUpdate',
      'triggerSelfUpdate',
    ]);
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [SelfUpdateComponent],
      providers: [
        { provide: OperationsService, useValue: operations },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelfUpdateComponent);
    component = fixture.componentInstance;
  });

  // The only panel on the page starts open (plan.md §839), but a person can
  // close it, so this clicks only if it is shut.
  function openPanel(): void {
    const toggle = (fixture.nativeElement as HTMLElement).querySelector(
      '.panel__toggle',
    ) as HTMLButtonElement | null;
    if (toggle?.getAttribute('aria-expanded') !== 'true') {
      toggle?.click();
    }
    fixture.detectChanges();
  }

  it('loads and displays the up-to-date status on init', () => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();
    openPanel();

    expect(operations.getSelfUpdateStatus).toHaveBeenCalled();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Up to date');
    // "Update now" stays clickable even on a cached "up to date" — clicking it
    // forces a fresh git fetch first, so a stale cache can't hide an update.
    const updateButton = (fixture.nativeElement as HTMLElement).querySelector('button.btn-primary') as HTMLButtonElement;
    expect(updateButton.disabled).toBe(false);
  });

  it('shows a warning when the last check failed', () => {
    operations.getSelfUpdateStatus.and.returnValue(
      of({ ...upToDateStatus, lastCheckError: { message: 'insufficient permission', at: new Date().toISOString() } }),
    );
    fixture.detectChanges();
    openPanel();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Last update check failed');
    expect(text).toContain('insufficient permission');
  });

  it('flags a stale check', () => {
    const old = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    operations.getSelfUpdateStatus.and.returnValue(
      of({ ...upToDateStatus, check: { ...upToDateStatus.check!, checkedAt: old } }),
    );
    fixture.detectChanges();
    openPanel();

    expect(component['checkIsStale']).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('stale');
  });

  it('force-checks before updating and bails out when the fresh check says up to date', () => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();
    operations.checkForSelfUpdate.and.returnValue(of(upToDateStatus.check!));

    component.updateNow();

    expect(operations.checkForSelfUpdate).toHaveBeenCalled();
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(operations.triggerSelfUpdate).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
  });

  it('force-checks before updating, then requires confirmation before triggering', () => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();
    operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));

    confirm.ask.and.returnValue(Promise.resolve(false));
    component.updateNow();

    expect(operations.checkForSelfUpdate).toHaveBeenCalled();
    expect(confirm.ask).toHaveBeenCalled();
    expect((confirm.ask.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeFalsy();
    expect(operations.triggerSelfUpdate).not.toHaveBeenCalled();
  });

  it('triggers the update and starts polling once confirmed', fakeAsync(() => {
    operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
    fixture.detectChanges();

    operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
    confirm.ask.and.returnValue(Promise.resolve(true));
    operations.triggerSelfUpdate.and.returnValue(of(runningRun));
    operations.getSelfUpdateStatus.and.returnValue(
      of({ ...behindStatus, latestRun: { ...runningRun, state: 'done', finishedAt: '2026-09-04T10:05:00.000Z' } })
    );

    component.updateNow();
    tick();
    fixture.detectChanges();

    expect(operations.triggerSelfUpdate).toHaveBeenCalled();

    tick(3000);
    expect(operations.getSelfUpdateStatus).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  it('does not blow up the poll on a request failure mid-restart, and keeps trying', fakeAsync(() => {
    operations.getSelfUpdateStatus.and.returnValue(of({ ...behindStatus, latestRun: runningRun }));
    fixture.detectChanges();

    operations.getSelfUpdateStatus.and.returnValue(throwError(() => new Error('connection refused')));
    tick(3000);

    // Still in progress — no toast, no crash, no unsubscribe.
    expect(toast.error).not.toHaveBeenCalled();

    component.ngOnDestroy();
  }));

  it('appends the run detail to the progress line when present', () => {
    operations.getSelfUpdateStatus.and.returnValue(of({ ...behindStatus, latestRun: { ...runningRun, detail: 'nextcloud (1/3)' } }));
    fixture.detectChanges();
    openPanel();

    expect(fixture.nativeElement.textContent).toContain('nextcloud (1/3)');
  });

  // plan.md §835 (P1): a failure printed "Last update failed: <raw tool output>"
  // and nothing about the box, and a run where some apps failed read "Up to date".
  describe('a failed update says what state the box is in', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const failed = (failedPhase: SelfUpdateRun['failedPhase'], errorMessage = 'fatal: could not read from remote repository') =>
      ({ ...upToDateStatus, latestRun: { ...runningRun, state: 'error', failedPhase, errorMessage, finishedAt: '2026-09-04T10:05:00.000Z' } }) as SelfUpdateStatus;
    const show = (status: SelfUpdateStatus) => {
      operations.getSelfUpdateStatus.and.returnValue(of(status));
      fixture.detectChanges();
      openPanel();
    };
    const alertText = () => (host().querySelector('.alert-danger') as HTMLElement).textContent ?? '';

    afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

    for (const [phase, words] of [
      ['checking', 'Nothing changed'],
      ['pulling', 'Nothing changed'],
      ['building', 'still running the previous version'],
      ['updating_apps', 'still running the previous version'],
      ['restarting_frontend', 'could not restart'],
      ['restarting_backend', 'could not restart'],
      [null, 'interrupted'],
    ] as const) {
      it(`says "${words}" when the run stopped in ${phase}`, () => {
        show(failed(phase));

        expect(alertText()).toContain(words);
      });
    }

    it('announces the failure', () => {
      show(failed('building'));

      expect(host().querySelector('.alert-danger')?.getAttribute('role')).toBe('alert');
    });

    it('keeps the raw output out of the headline, behind a closed disclosure', () => {
      show(failed('building', 'ERROR: failed to solve: process "/bin/sh -c npm ci" did not complete'));

      const details = host().querySelector('.alert-danger details') as HTMLDetailsElement;
      expect(details.open).toBeFalse();
      expect(details.querySelector('summary')?.textContent).toContain('Technical details');
      expect(details.querySelector('pre')?.textContent).toContain('failed to solve');
      expect((host().querySelector('.alert-danger strong') as HTMLElement).textContent).not.toContain('failed to solve');
    });

    it('caps a long log in a scroll box instead of stretching the page', () => {
      show(failed('building', 'line\n'.repeat(400)));

      const pre = host().querySelector('.alert-danger pre') as HTMLElement;
      expect(getComputedStyle(pre).maxHeight).not.toBe('none');
      expect(getComputedStyle(pre).overflowY).toBe('auto');
    });

    it('says it in Portuguese for a pt-PT reader, headline and disclosure', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      show(failed('building'));

      expect(alertText()).toContain('versão anterior');
      expect(alertText()).not.toContain('Technical details');
    });

    it('no longer prints "Last update failed:" with the raw message', () => {
      show(failed('building'));

      expect(host().textContent).not.toContain('Last update failed:');
    });

    it('does not show the failure for a run that landed', () => {
      show({ ...upToDateStatus, latestRun: { ...runningRun, state: 'done', finishedAt: '2026-09-04T10:05:00.000Z' } });

      expect(host().querySelector('.alert-danger')).toBeNull();
    });
  });

  describe('a run that landed with some apps failed', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const landed = (appsFailed: string[], state: SelfUpdateRun['state'] = 'done') =>
      ({ ...upToDateStatus, latestRun: { ...runningRun, state, appsFailed, finishedAt: '2026-09-04T10:05:00.000Z' } }) as SelfUpdateStatus;
    const show = (status: SelfUpdateStatus) => {
      operations.getSelfUpdateStatus.and.returnValue(of(status));
      fixture.detectChanges();
      openPanel();
    };

    it('names the apps that did not update, announced', () => {
      show(landed(['nextcloud', 'paperless']));

      const warning = host().querySelector('.alert-warning.apps-failed') as HTMLElement;
      expect(warning.getAttribute('role')).toBe('alert');
      expect(warning.textContent).toContain('2 apps did not update');
      expect(warning.textContent).toContain('nextcloud, paperless');
    });

    it('uses the singular for one app', () => {
      show(landed(['nextcloud']));

      expect((host().querySelector('.apps-failed') as HTMLElement).textContent).toContain('1 app did not update');
    });

    it('shows nothing when every app updated', () => {
      show(landed([]));

      expect(host().querySelector('.apps-failed')).toBeNull();
    });

    it('also shows after the dashboard restart, while the run still reads restarting_backend', () => {
      show(landed(['nextcloud'], 'restarting_backend'));

      expect(host().querySelector('.apps-failed')).not.toBeNull();
    });
  });

  it('has the new failure strings in both languages, free of git and deploy jargon', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('selfUpdate.failed.') || k.startsWith('selfUpdate.appsFailed.'))) {
      expect(ptPT[key]).withContext(`pt-PT ${key}`).toBeTruthy();
    }
    expect(Object.keys(en).filter((k) => k.startsWith('selfUpdate.failed.')).length).toBeGreaterThanOrEqual(5);
  });

  // plan.md §836 (§834 fix 2): the confirm named the restart but not that apps
  // are updated too, nor that nothing is backed up first. The service has no
  // rollback, so the confirm says what the owner can do before pressing.
  describe('the confirm says what an update does and does not do', () => {
    const askedMessage = (): string => {
      operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
      fixture.detectChanges();
      operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
      confirm.ask.and.returnValue(Promise.resolve(false));
      component.updateNow();
      return (confirm.ask.calls.mostRecent().args[0] as { message: string }).message;
    };

    afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

    it('names the restart, that changed apps update too, and that no backup is made first', () => {
      const message = askedMessage();

      expect(message).toContain('briefly unavailable');
      expect(message).toContain('apps that changed');
      expect(message).toContain('No backup is made first');
      expect(message).toContain('Backups page');
    });

    it('says it in Portuguese for a pt-PT reader', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      const message = askedMessage();

      expect(message).toContain('Não é feita nenhuma cópia de segurança');
      expect(message).toContain('Cópias de segurança');
    });
  });

  // plan.md §837 (§834 fix 3): the server's English reached the pt-PT screen in
  // toasts, the check-failed line and the progress detail.
  describe('nothing the server wrote in English reaches the screen', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const server = (status: number) => throwError(() => new HttpErrorResponse({ status, error: { error: 'fatal: unable to access the remote' } }));

    afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

    it('says a failed check in the app\'s words, in Portuguese for a pt-PT reader', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
      fixture.detectChanges();
      operations.checkForSelfUpdate.and.callFake(() => server(500));

      component.checkNow();

      const message = toast.error.calls.mostRecent().args[0] as string;
      expect(message).not.toContain('fatal');
      expect(message).toContain('verificar');
    });

    it('says an update is already running on a 409, not the server\'s sentence', () => {
      operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
      fixture.detectChanges();
      operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
      confirm.ask.and.returnValue(Promise.resolve(true));
      operations.triggerSelfUpdate.and.callFake(() => server(409));

      component.updateNow();

      return Promise.resolve().then(() => Promise.resolve()).then(() => {
        const message = toast.error.calls.mostRecent()?.args[0] as string;
        expect(message).toContain('already running');
      });
    });

    it('keeps the raw check error behind Technical details, with the translated line above it', () => {
      operations.getSelfUpdateStatus.and.returnValue(
        of({ ...upToDateStatus, lastCheckError: { message: 'fatal: unable to access', at: new Date().toISOString() } }),
      );
      fixture.detectChanges();
      openPanel();

      const alert = host().querySelector('.alert-warning') as HTMLElement;
      expect(alert.textContent).toContain('Last update check failed');
      const details = alert.querySelector('details') as HTMLDetailsElement;
      expect(details.open).toBeFalse();
      expect(details.textContent).toContain('fatal: unable to access');
    });

    it('names the two image targets in plain words in the progress line, in any language', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      operations.getSelfUpdateStatus.and.returnValue(of({ ...upToDateStatus, latestRun: { ...runningRun, state: 'building', detail: 'frontend' } }));
      fixture.detectChanges();
      openPanel();

      const text = host().querySelector('.alert-info')?.textContent ?? '';
      expect(text).not.toContain('frontend');
      expect(text).toContain('ecrãs');
    });

    it('leaves an app name in the progress line as it is', () => {
      operations.getSelfUpdateStatus.and.returnValue(of({ ...upToDateStatus, latestRun: { ...runningRun, state: 'updating_apps', detail: 'nextcloud (3/14)' } }));
      fixture.detectChanges();
      openPanel();

      expect(host().querySelector('.alert-info')?.textContent).toContain('nextcloud (3/14)');
    });
  });

  it('does not put the run\'s raw error in the toast when the poll sees a failed run', fakeAsync(() => {
    operations.getSelfUpdateStatus.and.returnValue(of({ ...upToDateStatus, latestRun: { ...runningRun } }));
    fixture.detectChanges();
    operations.getSelfUpdateStatus.and.returnValue(
      of({ ...upToDateStatus, latestRun: { ...runningRun, state: 'error', failedPhase: 'building', errorMessage: 'ERROR: failed to solve', finishedAt: '2026-09-04T10:05:00.000Z' } }),
    );

    tick(3000);
    discardPeriodicTasks();

    expect(toast.error).toHaveBeenCalledWith('The update failed.');
  }));

  // plan.md §838 (§834 fix 4): the progress was one silent line, focus fell to
  // <body> after every press, and a restart looked like a frozen page.
  describe('following an update', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const settle = () => new Promise((resolve) => setTimeout(resolve));
    const running = (state: SelfUpdateRun['state'], detail: string | null = null) =>
      ({ ...upToDateStatus, latestRun: { ...runningRun, state, detail } }) as SelfUpdateStatus;
    const show = (status: SelfUpdateStatus) => {
      operations.getSelfUpdateStatus.and.returnValue(of(status));
      fixture.detectChanges();
      openPanel();
    };
    const progress = () => host().querySelector('#update-progress') as HTMLElement | null;

    afterEach(() => TestBed.inject(TranslateService).setLocale('en'));

    it('is a status region, so a screen reader hears each step', () => {
      show(running('building'));

      expect(progress()?.getAttribute('role')).toBe('status');
    });

    for (const [state, step] of [['pulling', 1], ['building', 2], ['updating_apps', 3], ['restarting_frontend', 4], ['restarting_backend', 5]] as const) {
      it(`says "Step ${step} of 5" in ${state}`, () => {
        show(running(state));

        expect(progress()?.textContent).toContain(`Step ${step} of 5`);
      });
    }

    it('gives no step number while it is only checking', () => {
      show(running('checking'));

      expect(progress()?.textContent).not.toContain('Step');
    });

    it('says the page can stay open, and that it reconnects on its own', () => {
      show(running('building'));

      expect(progress()?.textContent).toContain('You can leave this page open');
    });

    it('says none of that when nothing is running', () => {
      show(upToDateStatus);

      expect(progress()).toBeNull();
    });

    it('says it in Portuguese for a pt-PT reader', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      show(running('building'));

      expect(progress()?.textContent).toContain('Passo 2 de 5');
      expect(progress()?.textContent).toContain('Pode deixar esta página aberta');
    });

    it('points the disabled buttons at the progress line, so they are not silent', () => {
      show(running('building'));

      for (const id of ['check-now', 'update-now']) {
        const button = host().querySelector('#' + id) as HTMLButtonElement;
        expect(button.disabled).toBeTrue();
        expect(button.getAttribute('aria-describedby')).toBe('update-progress');
      }
    });

    it('leaves the buttons undescribed when nothing is running', () => {
      show(upToDateStatus);

      expect((host().querySelector('#update-now') as HTMLElement).hasAttribute('aria-describedby')).toBeFalse();
    });

    it('puts focus on the progress line once the update starts, not on <body>', async () => {
      show(upToDateStatus);
      operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
      confirm.ask.and.returnValue(Promise.resolve(true));
      operations.triggerSelfUpdate.and.returnValue(of(runningRun));
      operations.getSelfUpdateStatus.and.returnValue(of({ ...behindStatus, latestRun: runningRun }));

      component.updateNow();
      await settle();
      fixture.detectChanges();
      await settle();

      expect(document.activeElement?.id).toBe('update-progress');
    });

    it('puts focus back on Update now when the confirm is declined', async () => {
      show(upToDateStatus);
      operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
      confirm.ask.and.returnValue(Promise.resolve(false));

      component.updateNow();
      await settle();
      fixture.detectChanges();
      await settle();

      expect(document.activeElement?.id).toBe('update-now');
    });

    it('puts focus back on Check now after a check', async () => {
      show(upToDateStatus);
      operations.checkForSelfUpdate.and.returnValue(of(upToDateStatus.check!));

      component.checkNow();
      fixture.detectChanges();
      await settle();

      expect(document.activeElement?.id).toBe('check-now');
    });
  });

  // plan.md §839 (§834 fix 5): the page opened as one closed accordion, the
  // status was a 10.5px badge read from the check alone ("Up to date" beside a
  // failed run), and a routine update's confirm was danger red.
  describe('the page earns trust at a glance', () => {
    const host = () => fixture.nativeElement as HTMLElement;
    const hero = () => host().querySelector('#update-status') as HTMLElement | null;
    const withRun = (run: Partial<SelfUpdateRun>, status: SelfUpdateStatus = upToDateStatus) =>
      ({ ...status, latestRun: { ...runningRun, finishedAt: '2026-09-04T10:05:00.000Z', ...run } }) as SelfUpdateStatus;
    const show = (status: SelfUpdateStatus, open = true) => {
      operations.getSelfUpdateStatus.and.returnValue(of(status));
      fixture.detectChanges();
      if (open) openPanel();
    };

    it('opens the panel without a click', () => {
      show(upToDateStatus, false);

      expect(host().querySelector('#update-now')).not.toBeNull();
    });

    it('still closes when the person closes it', () => {
      show(upToDateStatus, false);
      (host().querySelector('.panel__toggle') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(host().querySelector('#update-now')).toBeNull();
    });

    it('leads with one status line, with the running version beside it', () => {
      show(upToDateStatus);

      expect(hero()?.textContent).toContain('Up to date');
      expect(host().textContent).toContain('v0.24.0');
    });

    it('says "Last update failed" in red, not "Up to date", when the latest run failed', () => {
      show(withRun({ state: 'error', failedPhase: 'building', errorMessage: 'x' }));

      expect(hero()?.textContent).toContain('Last update failed');
      expect(hero()?.textContent).not.toContain('Up to date');
      expect(hero()?.querySelector('.badge')?.classList).toContain('text-bg-danger');
    });

    it('says "Updated, 2 apps need attention" in amber when apps failed', () => {
      show(withRun({ state: 'done', appsFailed: ['a', 'b'] }));

      expect(hero()?.textContent).toContain('2 apps need attention');
      expect(hero()?.querySelector('.badge')?.classList).toContain('text-bg-warning');
    });

    it('says how many updates are waiting when the latest run is clean', () => {
      show(withRun({ state: 'done' }, behindStatus));

      expect(hero()?.textContent).toContain('2 updates available');
    });

    it('says Updating while a run is going', () => {
      show({ ...upToDateStatus, latestRun: runningRun });

      expect(hero()?.textContent).toContain('Updating');
    });

    it('says Not checked yet when there is nothing to say', () => {
      show({ ...upToDateStatus, check: null });

      expect(hero()?.textContent).toContain('Not checked yet');
    });

    it('sets the badges at 12px or more', () => {
      show(withRun({ state: 'done' }, {
        ...upToDateStatus,
        check: { ...upToDateStatus.check!, checkedAt: new Date(Date.now() - 12 * 3600_000).toISOString() },
      }));

      const badges = Array.from(host().querySelectorAll('.badge'));
      expect(badges.length).toBeGreaterThanOrEqual(2);
      for (const badge of badges) {
        expect(parseFloat(getComputedStyle(badge).fontSize)).toBeGreaterThanOrEqual(12);
      }
    });

    it('confirms a routine update with a primary button, not a danger red one', () => {
      operations.getSelfUpdateStatus.and.returnValue(of(upToDateStatus));
      fixture.detectChanges();
      operations.checkForSelfUpdate.and.returnValue(of(behindStatus.check!));
      confirm.ask.and.returnValue(Promise.resolve(false));

      component.updateNow();

      expect((confirm.ask.calls.mostRecent().args[0] as { danger?: boolean }).danger).toBeFalsy();
    });

    it('says it in Portuguese for a pt-PT reader', () => {
      TestBed.inject(TranslateService).setLocale('pt-PT');
      show(withRun({ state: 'error', failedPhase: 'building', errorMessage: 'x' }));

      expect(hero()?.textContent).toContain('A última atualização falhou');
      TestBed.inject(TranslateService).setLocale('en');
    });
  });
});
