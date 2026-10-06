import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError, Observable } from 'rxjs';
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
      el.querySelectorAll<HTMLButtonElement>('.panel__toggle').forEach((b) => b.textContent?.includes('Drafts') && b.click());
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
      el.querySelectorAll<HTMLButtonElement>('.panel__toggle').forEach((b) => {
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
