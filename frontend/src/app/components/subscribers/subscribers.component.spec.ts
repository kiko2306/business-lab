import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { SubscribersComponent } from './subscribers.component';
import { ConfirmService } from '../../core/confirm.service';
import { Subscriber } from '../../core/models';
import { SocialService } from '../../core/social.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §847 / §845 fix 2: the mailing list is managed on the page where the
// posts are written. Adding never overrides an opt-out; removing asks first and
// names the address.
describe('SubscribersComponent', () => {
  let fixture: ComponentFixture<SubscribersComponent>;
  let el: HTMLElement;
  let social: jasmine.SpyObj<SocialService>;
  let confirm: jasmine.SpyObj<ConfirmService>;

  const row = (id: number, email: string, unsubscribedAt: string | null = null): Subscriber => ({
    id,
    email,
    subscribedAt: '2026-10-01T10:00:00.000Z',
    unsubscribedAt,
  });

  const setUp = async (list: Observable<{ subscribers: Subscriber[] }>) => {
    localStorage.clear();
    social = jasmine.createSpyObj('SocialService', ['listSubscribers', 'addSubscriber', 'removeSubscriber']);
    social.listSubscribers.and.returnValue(list);
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    confirm.ask.and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [SubscribersComponent],
      providers: [
        { provide: SocialService, useValue: social },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(SubscribersComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.panel__toggle')!.click(); // panels start collapsed
    fixture.detectChanges();
    await fixture.whenStable(); // ngModel registers with its form a microtask after it renders
  };

  const text = () => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const status = () => el.querySelector('[role="status"]')?.textContent?.trim();
  const input = () => el.querySelector<HTMLInputElement>('input[type="email"]')!;
  const typeAndAdd = async (value: string) => {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges(); // a browser runs change detection after each keystroke
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve)); // the cleared model reaches the input a task later
    fixture.detectChanges();
  };

  it('lists everyone with a status word, and counts active against unsubscribed', async () => {
    await setUp(of({ subscribers: [row(1, 'a@example.com'), row(2, 'b@example.com', '2026-10-03T10:00:00.000Z')] }));
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(rows[0]).toContain('a@example.com');
    expect(rows[0]).toContain('Subscribed');
    expect(rows[1]).toContain('Unsubscribed');
    expect(text()).toContain('1 subscribed, 1 unsubscribed');
  });

  it('says what an empty list is for', async () => {
    await setUp(of({ subscribers: [] }));
    expect(text()).toContain('No subscribers yet.');
  });

  it('shows an inline error with Try again when the list will not load, and recovers', async () => {
    await setUp(throwError(() => new Error('500')));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Could not load the subscribers.');
    social.listSubscribers.and.returnValue(of({ subscribers: [row(1, 'a@example.com')] }));
    el.querySelector<HTMLButtonElement>('.subscribers__retry')!.click();
    fixture.detectChanges();
    expect(text()).toContain('a@example.com');
    expect(el.querySelector('.subscribers__retry')).toBeNull();
  });

  it('adds an address, clears the box, announces it and keeps the cursor in the box', async () => {
    await setUp(of({ subscribers: [] }));
    social.addSubscriber.and.returnValue(of({ result: 'added' as const }));
    social.listSubscribers.and.returnValue(of({ subscribers: [row(1, 'new@example.com')] }));
    await typeAndAdd('new@example.com');
    expect(social.addSubscriber).toHaveBeenCalledWith('new@example.com');
    expect(input().value).toBe('');
    expect(status()).toBe('Added new@example.com.');
    expect(text()).toContain('new@example.com');
    expect(document.activeElement).toBe(input());
  });

  it('says so when the address is already on the list', async () => {
    await setUp(of({ subscribers: [row(1, 'a@example.com')] }));
    social.addSubscriber.and.returnValue(of({ result: 'exists' as const }));
    await typeAndAdd('a@example.com');
    expect(status()).toBe('a@example.com is already on the list.');
  });

  it('explains an opt-out instead of overriding it (409), in the page language', async () => {
    await setUp(of({ subscribers: [] }));
    social.addSubscriber.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    await typeAndAdd('gone@example.com');
    const alert = el.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain('unsubscribed');
    expect(alert).toContain('Only they can sign up again');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('gone@example.com'); // kept, so it can be corrected
  });

  it('drops the error as soon as the owner starts correcting the address', async () => {
    await setUp(of({ subscribers: [] }));
    social.addSubscriber.and.returnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
    await typeAndAdd('oops');
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    input().value = 'oops@';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(input().getAttribute('aria-invalid')).toBeNull();
  });

  it('does not call the server for an empty box', async () => {
    await setUp(of({ subscribers: [] }));
    await typeAndAdd('   ');
    expect(social.addSubscriber).not.toHaveBeenCalled();
  });

  it('asks before removing, naming the address, then removes and announces it', async () => {
    await setUp(of({ subscribers: [row(1, 'a@example.com'), row(2, 'b@example.com')] }));
    social.removeSubscriber.and.returnValue(of(undefined));
    const button = el.querySelector<HTMLButtonElement>('tbody tr button')!;
    expect(button.getAttribute('aria-label')).toBe('Remove a@example.com');
    button.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(confirm.ask.calls.mostRecent().args[0].message).toContain('a@example.com');
    expect(confirm.ask.calls.mostRecent().args[0].danger).toBeTrue();
    expect(social.removeSubscriber).toHaveBeenCalledWith(1);
    expect(Array.from(el.querySelectorAll('tbody tr')).map((r) => r.textContent)).not.toContain(jasmine.stringMatching('a@example.com'));
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(status()).toBe('Removed a@example.com.');
    expect(document.activeElement).toBe(input());
  });

  it('removes nothing when the owner cancels', async () => {
    await setUp(of({ subscribers: [row(1, 'a@example.com')] }));
    confirm.ask.and.resolveTo(false);
    el.querySelector<HTMLButtonElement>('tbody tr button')!.click();
    await fixture.whenStable();
    expect(social.removeSubscriber).not.toHaveBeenCalled();
  });

  it('has every social.subscribers.* string in both languages', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('social.subscribers.'));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) expect(ptPT[key]).withContext(key).toBeTruthy();
  });
});
