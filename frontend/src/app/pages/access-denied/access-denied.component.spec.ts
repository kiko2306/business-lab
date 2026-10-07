import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { AccessDeniedComponent } from './access-denied.component';
import { AuthService } from '../../core/auth.service';
import { OperationsService } from '../../core/operations.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §854 fix 6: the person is signed in and was refused; the page says so, never
// disables Request access without a reason, and moves focus to the answer.
describe('AccessDeniedComponent', () => {
  let fixture: ComponentFixture<AccessDeniedComponent>;
  let el: HTMLElement;
  let operations: jasmine.SpyObj<OperationsService>;

  const setUp = (username: string | null) => {
    operations = jasmine.createSpyObj('OperationsService', ['submitAccessRequest']);
    TestBed.configureTestingModule({
      imports: [AccessDeniedComponent],
      providers: [
        provideRouter([]),
        { provide: OperationsService, useValue: operations },
        { provide: AuthService, useValue: { user$: new BehaviorSubject(username ? { id: 1, username } : null), logout: jasmine.createSpy('logout') } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => 'notes.example.com' } } } },
      ],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(AccessDeniedComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  };
  const submit = () => el.querySelector<HTMLButtonElement>('button[type=submit]')!;

  it('sits in the shared card, with one main and one heading', () => {
    setUp(null);
    expect(el.querySelectorAll('main').length).toBe(1);
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('.auth-card')).not.toBeNull();
  });

  it('says who is signed in when it knows, and offers a different account as a real button', () => {
    setUp('ana');
    expect(el.textContent).toContain('ana');
    const other = el.querySelector<HTMLElement>('.access-denied__other')!;
    expect(other.classList).toContain('btn');
    expect(other.textContent).toContain(en['accessDenied.otherAccount']);
  });

  it('says nothing about an account it cannot name', () => {
    setUp(null);
    expect(el.textContent).not.toContain(en['accessDenied.signedInAs'].replace('{{user}}', ''));
  });

  it('never disables Request access for an empty form: pressing it names what is missing', () => {
    setUp(null);
    expect(submit().disabled).toBeFalse();
    submit().click();
    fixture.detectChanges();
    expect(operations.submitAccessRequest).not.toHaveBeenCalled();
    expect(el.textContent).toContain(en['accessDenied.emailError']);
    expect(el.textContent).toContain(en['accessDenied.reasonError']);
  });

  it('moves focus to the confirmation after sending', () => {
    setUp(null);
    operations.submitAccessRequest.and.returnValue(of(undefined));
    fixture.componentInstance['form'].setValue({ email: 'a@b.pt', reason: 'need it' });
    submit().click();
    fixture.detectChanges();
    const result = el.querySelector<HTMLElement>('[role=status]')!;
    expect(result.textContent).toContain(en['accessDenied.requestSent']);
    expect(document.activeElement).toBe(result);
  });

  it('has the new strings in both languages', () => {
    for (const key of ['accessDenied.signedInAs', 'accessDenied.otherAccount']) {
      expect(en[key]).withContext(key).toBeTruthy();
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
