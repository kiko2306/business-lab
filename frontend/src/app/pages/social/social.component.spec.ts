import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { of, throwError, Observable, Subject } from 'rxjs';
import { SocialComponent } from './social.component';
import { ConfirmService } from '../../core/confirm.service';
import { SocialDraft } from '../../core/models';
import { SocialService } from '../../core/social.service';
import { ToastService } from '../../core/toast.service';
import { en } from '../../i18n/en';
import { ptPT } from '../../i18n/pt-pt';
import { TranslateService } from '../../i18n/translate.service';

// plan.md §845 fix 1 (P0): the server emails the *saved* copy, so Publish
// must never fire while the textarea shows something else.
describe('SocialComponent publish', () => {
  const draft = (over: Partial<SocialDraft> = {}): SocialDraft =>
    ({ id: 7, prompt: 'A sale', content: 'Saved copy', createdAt: '', updatedAt: '', lastSentAt: null, lastSentCount: null, ...over }) as SocialDraft;

  let social: jasmine.SpyObj<SocialService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let component: SocialComponent;
  let calls: string[];
  let recipients = 3;
  let fixture: ComponentFixture<SocialComponent>;

  const setUp = (d: SocialDraft, edit: string) => {
    calls = [];
    recipients = 3;
    social = jasmine.createSpyObj('SocialService', ['listDrafts', 'updateContent', 'publish', 'generate', 'deleteDraft', 'listSubscribers', 'previewPublish']);
    social.previewPublish.and.callFake((content: string) => of({ subject: content.split('\n')[0].slice(0, 200), recipients }));
    social.listSubscribers.and.returnValue(of({ subscribers: [] }));
    social.listDrafts.and.returnValue(of({ drafts: [d] }));
    social.updateContent.and.callFake((id: number, content: string) => {
      calls.push('save');
      return of({ draft: { ...d, content: content.trim() } });
    });
    social.publish.and.callFake(() => {
      calls.push('publish');
      return of({ sent: 3, failed: 0, total: 3 });
    });
    confirm = jasmine.createSpyObj('ConfirmService', ['ask']);
    confirm.ask.and.resolveTo(true);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    TestBed.configureTestingModule({
      imports: [SocialComponent],
      providers: [
        provideRouter([]),
        { provide: SocialService, useValue: social },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).setLocale('en');
    fixture = TestBed.createComponent(SocialComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
    component['edits'][d.id] = edit;
  };

  it('publishes a clean draft after the plain confirm', async () => {
    setUp(draft(), 'Saved copy');
    await component.publish(draft());
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('3 subscribers');
    expect(message).toContain('Subject: Saved copy');
    expect(message).not.toContain('not saved yet');
    expect(calls).toEqual(['publish']);
  });

  it('saves unsaved edits first, then publishes, and the dialog says so', async () => {
    setUp(draft(), 'Edited copy');
    await component.publish(draft());
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('not saved yet');
    expect(message).toContain('Subject: Edited copy');
    expect(social.previewPublish).toHaveBeenCalledWith('Edited copy'); // the text on screen, not the saved one
    expect(social.updateContent).toHaveBeenCalledWith(7, 'Edited copy');
    expect(calls).toEqual(['save', 'publish']);
  });

  it('does neither when the owner cancels', async () => {
    setUp(draft(), 'Edited copy');
    confirm.ask.and.resolveTo(false);
    await component.publish(draft());
    expect(calls).toEqual([]);
  });

  it('does not publish when saving the edit fails', async () => {
    setUp(draft(), 'Edited copy');
    social.updateContent.and.returnValue(throwError(() => new Error('nope')) as Observable<never>);
    await component.publish(draft());
    expect(social.publish).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('refuses to publish when the text has been cleared, rather than sending the old copy', async () => {
    setUp(draft(), '   ');
    await component.publish(draft());
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(toast.error).toHaveBeenCalledWith(en['social.errors.publishEmpty']);
  });

  // plan.md §845 fix 3: the confirm says who, what subject and what text — and when it already went.
  it('names the number of subscribers, the subject and a preview of the text', async () => {
    setUp(draft({ content: 'Big sale this week\nEverything must go, ten percent off' }), 'Big sale this week\nEverything must go, ten percent off');
    await component.publish(draft({ content: 'Big sale this week\nEverything must go, ten percent off' }));
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('3 subscribers');
    expect(message).toContain('Subject: Big sale this week');
    expect(message).toContain('Everything must go, ten percent off');
    expect(message).toContain('cannot be undone');
  });

  it('says "1 subscriber" for one', async () => {
    setUp(draft(), 'Saved copy');
    recipients = 1;
    await component.publish(draft());
    expect(confirm.ask.calls.mostRecent().args[0].message).toContain('1 subscriber ');
  });

  it('cuts a long text to a preview instead of filling the dialog', async () => {
    const long = 'x'.repeat(2000);
    setUp(draft({ content: long }), long);
    await component.publish(draft({ content: long }));
    expect(confirm.ask.calls.mostRecent().args[0].message.length).toBeLessThan(700);
  });

  it('warns when the draft already went out, with the date and the count', async () => {
    const sent = draft({ lastSentAt: '2026-10-01T10:00:00Z', lastSentCount: 12 });
    setUp(sent, 'Saved copy');
    await component.publish(sent);
    const message = confirm.ask.calls.mostRecent().args[0].message;
    expect(message).toContain('already sent this post');
    expect(message).toContain('12');
  });

  it('does not ask, and says why, when there is nobody to send to', async () => {
    setUp(draft(), 'Saved copy');
    recipients = 0;
    await component.publish(draft());
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(social.publish).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(en['social.errors.noSubscribers']);
  });

  it('sends nothing when the preview cannot be fetched', async () => {
    setUp(draft(), 'Saved copy');
    social.previewPublish.and.returnValue(throwError(() => new Error('500')) as Observable<never>);
    await component.publish(draft());
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(social.publish).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(en['social.errors.prepareSend']);
  });

  // plan.md §845 fix 4: a send that mostly worked is a warning, not an error, and it leaves a trace.
  describe('a partial send', () => {
    const partial = () => social.publish.and.returnValue(of({ sent: 3, failed: 2, total: 5 }));

    it('is a warning with the failed count, not a red error', async () => {
      setUp(draft(), 'Saved copy');
      partial();
      await component.publish(draft());
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.warning).toHaveBeenCalledWith('Sent to 3 of 5 subscribers. 2 did not get it.');
    });

    it('stays on the draft after the toast is gone, and says what sending again would do', async () => {
      localStorage.clear(); // an earlier spec may have left the Drafts panel open
      setUp(draft(), 'Saved copy');
      partial();
      await component.publish(draft());
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      el.querySelectorAll<HTMLButtonElement>('.panel__toggle[aria-expanded="false"]').forEach((b) => b.textContent?.includes('Drafts') && b.click());
      fixture.detectChanges();
      const line = el.querySelector('.social-partial')?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(line).toContain('2 of 5 subscribers did not get it');
      expect(line).toContain('emails everyone on the list again');
    });

    it('is cleared by the next send that goes through to everyone', async () => {
      setUp(draft(), 'Saved copy');
      partial();
      await component.publish(draft());
      social.publish.and.returnValue(of({ sent: 5, failed: 0, total: 5 }));
      await component.publish(draft());
      expect(component['partial'][7]).toBeUndefined();
      expect(toast.success).toHaveBeenCalled();
    });
  });

  // plan.md §845 fix 5: the wait is announced, failures sit beside the button in the
  // page's language, and focus never falls to <body>.
  describe('Generate, failures and focus', () => {
    const openAll = () => {
      localStorage.clear();
      const el: HTMLElement = fixture.nativeElement;
      el.querySelectorAll<HTMLButtonElement>('.panel__toggle[aria-expanded="false"]').forEach((b) => b.click()); // some start open now (§845 fix 6)
      fixture.detectChanges();
      return el;
    };
    const type = async (el: HTMLElement, text: string) => {
      await fixture.whenStable();
      const box = el.querySelector<HTMLTextAreaElement>('#prompt')!;
      box.value = text;
      box.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return box;
    };

    it('keeps focus on the button while generating and says what is happening', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      const wait$ = new Subject<{ draft: SocialDraft }>();
      social.generate.and.returnValue(wait$);
      const el = openAll();
      await type(el, 'A sale');
      const button = el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
      button.focus();
      button.click();
      fixture.detectChanges();
      expect(button.disabled).toBeFalse();
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).toBe(button);
      expect(el.querySelector('.social-generate-status')?.textContent?.trim()).toBe(en['social.generateWait']);
    });

    it('announces the new draft and puts the cursor in it', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      social.generate.and.returnValue(of({ draft: draft({ id: 9, prompt: 'A sale', content: 'Fresh text' }) }));
      const el = openAll();
      await type(el, 'A sale');
      fixture.autoDetectChanges(true); // as in the app: the card renders before focus moves to it
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      expect(component['announcement']).toBe(en['social.toast.generated']);
      const box = document.activeElement as HTMLTextAreaElement;
      expect(box.tagName).toBe('TEXTAREA');
      expect(box.value).toBe('Fresh text');
    });

    it('with no AI key, says so beside the button and links to Settings, not a vanishing toast', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      social.generate.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'No AI provider key configured for social-posts.' } })));
      const el = openAll();
      await type(el, 'A sale');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
      const alert = el.querySelector('[role="alert"].social-generate-error');
      expect(alert?.textContent).toContain(en['social.errors.noAiKey']);
      expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/settings');
      expect(toast.error).not.toHaveBeenCalled();
      expect(component['prompt']).toBe('A sale'); // the brief survives
    });

    it('for any other failure, says it in the page language and keeps the brief', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      TestBed.inject(TranslateService).setLocale('pt-PT');
      social.generate.and.returnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'Anthropic API error 529' } })));
      const el = openAll();
      await type(el, 'A sale');
      el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      fixture.detectChanges();
      const text = el.querySelector('.social-generate-error')?.textContent ?? '';
      expect(text).toContain(ptPT['social.errors.generate']);
      expect(text).not.toContain('Anthropic');
    });

    it('shows Try again, not an endless "Loading…", when the drafts will not load', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      social.listDrafts.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      component.ngOnInit();
      const el = openAll();
      expect(el.querySelector('.social-load-error')?.textContent).toContain(en['social.errors.loadDrafts']);
      expect(el.textContent).not.toContain('Loading…');
      social.listDrafts.and.returnValue(of({ drafts: [draft()] }));
      el.querySelector<HTMLButtonElement>('.social-load-error button')!.click();
      fixture.detectChanges();
      expect(el.querySelector('.social-load-error')).toBeNull();
      expect(el.querySelectorAll('.border.rounded').length).toBe(1);
    });

    it('puts the cursor back in the draft after Save', async () => {
      localStorage.clear();
      setUp(draft(), 'Edited');
      const el = openAll();
      fixture.autoDetectChanges(true);
      el.querySelector<HTMLButtonElement>('.border.rounded button.btn-outline-primary')!.click(); // Save
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      expect((document.activeElement as HTMLElement).tagName).toBe('TEXTAREA');
    });

    it('puts the cursor in the brief box after a draft is deleted', async () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      social.deleteDraft.and.returnValue(of(undefined));
      const el = openAll();
      el.querySelector<HTMLButtonElement>('.border.rounded button.btn-outline-danger')!.click();
      await fixture.whenStable();
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      expect(document.activeElement?.id).toBe('prompt');
      expect(component['announcement']).toBe(en['social.toast.deleted']);
    });

    it('does not let backend English reach the page: errors are our own strings, by status', async () => {
      setUp(draft(), 'Saved copy');
      TestBed.inject(TranslateService).setLocale('pt-PT');
      social.publish.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'Configure the shared mailbox in Settings before publishing.' } })));
      await component.publish(draft());
      expect(toast.error).toHaveBeenCalledWith(ptPT['social.errors.publishNotReady']);
      social.publish.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { error: 'Unable to publish the draft.' } })));
      await component.publish(draft());
      expect(toast.error).toHaveBeenCalledWith(ptPT['social.errors.publish']);
    });
  });

  // plan.md §845 fix 6: the page opens on its task, in plain words.
  describe('first visit and wording', () => {
    it('opens the Generate panel, and the Drafts panel when there are drafts, without a click', () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#prompt')).not.toBeNull();
      expect(el.querySelectorAll('.border.rounded').length).toBe(1);
    });

    it('leaves the Drafts panel closed when there are none yet', () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      social.listDrafts.and.returnValue(of({ drafts: [] }));
      component.ngOnInit();
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('#prompt')).not.toBeNull();
      expect(el.textContent).not.toContain(en['social.noDraftsYet']);
    });

    it('says "what should the post say", not "brief" or the AI vendor, in both languages', () => {
      for (const dict of [en, ptPT]) {
        for (const key of Object.keys(dict).filter((k) => k.startsWith('social.'))) {
          expect(dict[key].replace(/{{[^}]*}}/g, '')).withContext(key).not.toMatch(/\bbrief(ing)?\b|\bclaude\b/i);
        }
      }
      expect(en['social.callingClaude']).toBeUndefined();
      expect(ptPT['social.callingClaude']).toBeUndefined();
    });
  });

  describe('Copy', () => {
    it('copies the text on screen, not the saved copy, and announces it', async () => {
      setUp(draft(), 'Edited on screen');
      const writeText = jasmine.createSpy('writeText').and.resolveTo();
      spyOnProperty(navigator, 'clipboard', 'get').and.returnValue({ writeText } as unknown as Clipboard);
      await component.copy(draft());
      expect(writeText).toHaveBeenCalledWith('Edited on screen');
      expect(component['announcement']).toBe(en['social.toast.copied']);
    });

    it('falls back to selecting and copying when the clipboard API is not available (plain-http LAN)', async () => {
      setUp(draft(), 'Edited on screen');
      spyOnProperty(navigator, 'clipboard', 'get').and.returnValue(undefined as unknown as Clipboard);
      const exec = spyOn(document, 'execCommand').and.returnValue(true);
      await component.copy(draft());
      expect(exec).toHaveBeenCalledWith('copy');
      expect(component['announcement']).toBe(en['social.toast.copied']);
    });

    it('says so, and does not claim success, when copying fails', async () => {
      setUp(draft(), 'Edited on screen');
      spyOnProperty(navigator, 'clipboard', 'get').and.returnValue(undefined as unknown as Clipboard);
      spyOn(document, 'execCommand').and.returnValue(false);
      await component.copy(draft());
      expect(toast.error).toHaveBeenCalledWith(en['social.errors.copy']);
      expect(component['announcement']).toBe('');
    });
  });

  describe('on the page', () => {
    const open = (...labels: string[]) => {
      const el: HTMLElement = fixture.nativeElement;
      el.querySelectorAll<HTMLButtonElement>('.panel__toggle[aria-expanded="false"]').forEach((b) => {
        if (labels.some((l) => b.textContent?.includes(l))) b.click();
      });
      fixture.detectChanges();
      return el;
    };

    it('leads each draft with Copy and names the send for what it is', () => {
      localStorage.clear();
      setUp(draft(), 'Saved copy');
      const el = open('Drafts');
      const buttons = Array.from(el.querySelectorAll('app-social .border.rounded button, .border.rounded button')).map((b) => b.textContent?.trim());
      expect(buttons).toEqual(['Copy', 'Save', 'Email to subscribers', 'Delete']);
    });

    it('shows "Sent <date> to N" on a draft that went out, and nothing on one that did not', () => {
      localStorage.clear();
      setUp(draft({ lastSentAt: '2026-10-01T10:00:00Z', lastSentCount: 12 }), 'Saved copy');
      social.listDrafts.and.returnValue(of({ drafts: [draft({ lastSentAt: '2026-10-01T10:00:00Z', lastSentCount: 12 }), draft({ id: 8 })] }));
      fixture.componentInstance.ngOnInit();
      const el = open('Drafts');
      const lines = Array.from(el.querySelectorAll('.border.rounded')).map((c) => c.querySelector('.social-sent')?.textContent?.trim() ?? null);
      expect(lines[0]).toContain('Sent');
      expect(lines[0]).toContain('12 subscribers');
      expect(lines[1]).toBeNull();
    });
  });

  it('has the new strings in both languages', () => {
    for (const key of [
      'social.confirmPublish.unsavedNote',
      'social.confirmPublish.cannotUndo',
      'social.confirmPublish.alreadySent',
      'social.confirmPublish.messageOne',
      'social.confirmPublish.subject',
      'social.errors.publishEmpty',
      'social.errors.prepareSend',
      'social.partialLine',
      'social.generateWait',
      'social.errors.noAiKey',
      'social.errors.publishNotReady',
      'social.errors.settingsLink',
      'social.errors.retryLoad',
      'social.toast.deleted',
      'social.sentLine',
      'social.sentLineOne',
      'social.copyButton',
      'social.toast.copied',
      'social.errors.copy',
    ]) {
      expect(en[key]).withContext(key).toBeTruthy();
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
