import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { UnsubscribeComponent } from './unsubscribe.component';
import { OperationsService } from '../../core/operations.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §854 fix 1: opening the link unsubscribes nobody. Mail gateways open links
// in a browser that runs scripts; only a tap on the button does it.
describe('UnsubscribeComponent', () => {
  let fixture: ComponentFixture<UnsubscribeComponent>;
  let el: HTMLElement;
  let operations: jasmine.SpyObj<OperationsService>;

  const setUp = (token: string | null = 'tok123', sender: string | null = 'dash.example.com') => {
    operations = jasmine.createSpyObj('OperationsService', ['unsubscribe', 'resubscribe', 'getUnsubscribeSender']);
    operations.getUnsubscribeSender.and.returnValue(of({ sender }));
    TestBed.configureTestingModule({
      imports: [UnsubscribeComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => token } } } },
      ],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(UnsubscribeComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  };
  const button = () => el.querySelector<HTMLButtonElement>('button.unsubscribe__confirm');
  const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';

  it('makes no request on load, and offers one clear button', () => {
    setUp();
    expect(operations.unsubscribe).not.toHaveBeenCalled();
    expect(button()?.textContent?.trim()).toBe('Unsubscribe me');
    expect(text()).not.toContain('You’ve been unsubscribed.');
  });

  it('unsubscribes only when the button is pressed, and says so in a live region', () => {
    setUp();
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    expect(operations.unsubscribe).toHaveBeenCalledOnceWith('tok123');
    expect(el.querySelector('[role="status"]')?.textContent).toContain('You’ve been unsubscribed.');
    expect(button()).toBeNull();
  });

  it('shows the wait without letting a second tap send a second request', () => {
    setUp();
    const pending = new Subject<void>();
    operations.unsubscribe.and.returnValue(pending);
    button()!.click();
    fixture.detectChanges();
    expect(text()).toContain(en['unsubscribe.working']);
    expect(button()?.getAttribute('aria-disabled')).toBe('true');
    button()!.click();
    expect(operations.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('on failure shows the error and leaves the button to try again', () => {
    setUp();
    operations.unsubscribe.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    button()!.click();
    fixture.detectChanges();
    expect(el.querySelector('.alert-danger')).not.toBeNull();
    expect(button()).not.toBeNull();
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    expect(text()).toContain('You’ve been unsubscribed.');
  });

  it('with no token, explains and offers no button', () => {
    setUp(null);
    expect(text()).toContain(en['unsubscribe.errors.missingToken']);
    expect(button()).toBeNull();
  });

  // plan.md §854 fix 2: whose list it is, a way back, and no admin door for a customer.
  it('says whose emails these are, before the button and after it', () => {
    setUp('tok123', 'dash.example.com');
    expect(text()).toContain('dash.example.com');
    expect(el.querySelector('.auth-kicker')?.textContent).toContain('dash.example.com');
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('dash.example.com');
  });

  it('still works, in plain words, when the sender is unknown', () => {
    setUp('tok123', null);
    expect(button()).not.toBeNull();
    expect(text()).not.toContain('null');
    expect(el.querySelector('.auth-kicker')?.textContent?.trim()).toBe(en['unsubscribe.kickerFallback']);
  });

  it('offers a way back after unsubscribing, and takes it', () => {
    setUp();
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    const undo = el.querySelector<HTMLButtonElement>('button.unsubscribe__undo')!;
    expect(undo.textContent?.trim()).toBe(en['unsubscribe.undo']);
    operations.resubscribe.and.returnValue(of(undefined));
    undo.click();
    fixture.detectChanges();
    expect(operations.resubscribe).toHaveBeenCalledOnceWith('tok123');
    expect(el.querySelector('[role="status"]')?.textContent).toContain(en['unsubscribe.resubscribed']);
    expect(el.querySelector('button.unsubscribe__undo')).toBeNull();
  });

  it('does not send a customer to the admin sign-in', () => {
    setUp();
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    expect(el.querySelector('a[href="/login"]')).toBeNull();
  });

  it('sits in the shared card, with one main and one heading', () => {
    setUp();
    expect(el.querySelectorAll('main').length).toBe(1);
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('.auth-card')).not.toBeNull();
  });

  it('has the new strings in both languages', () => {
    for (const key of ['unsubscribe.button', 'unsubscribe.intro', 'unsubscribe.introFrom', 'unsubscribe.doneFrom', 'unsubscribe.undo', 'unsubscribe.resubscribed', 'unsubscribe.kickerFallback']) {
      expect(en[key]).withContext(key).toBeTruthy();
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
