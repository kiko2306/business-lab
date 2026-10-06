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

  const setUp = (token: string | null = 'tok123') => {
    operations = jasmine.createSpyObj('OperationsService', ['unsubscribe']);
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
    expect(text()).not.toContain(en['unsubscribe.done']);
  });

  it('unsubscribes only when the button is pressed, and says so in a live region', () => {
    setUp();
    operations.unsubscribe.and.returnValue(of(undefined));
    button()!.click();
    fixture.detectChanges();
    expect(operations.unsubscribe).toHaveBeenCalledOnceWith('tok123');
    expect(el.querySelector('[role="status"]')?.textContent).toContain(en['unsubscribe.done']);
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
    expect(text()).toContain(en['unsubscribe.done']);
  });

  it('with no token, explains and offers no button', () => {
    setUp(null);
    expect(text()).toContain(en['unsubscribe.errors.missingToken']);
    expect(button()).toBeNull();
  });

  it('has the new strings in both languages', () => {
    for (const key of ['unsubscribe.button', 'unsubscribe.intro']) {
      expect(en[key]).withContext(key).toBeTruthy();
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
