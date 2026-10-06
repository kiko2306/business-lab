import { TestBed } from '@angular/core/testing';
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
    ({ id: 7, prompt: 'A sale', content: 'Saved copy', createdAt: '', updatedAt: '', ...over }) as SocialDraft;

  let social: jasmine.SpyObj<SocialService>;
  let confirm: jasmine.SpyObj<ConfirmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let component: SocialComponent;
  let calls: string[];

  const setUp = (d: SocialDraft, edit: string) => {
    calls = [];
    social = jasmine.createSpyObj('SocialService', ['listDrafts', 'updateContent', 'publish', 'generate', 'deleteDraft']);
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
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      imports: [SocialComponent],
      providers: [
        { provide: SocialService, useValue: social },
        { provide: ConfirmService, useValue: confirm },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(TranslateService).setLocale('en');
    const fixture = TestBed.createComponent(SocialComponent);
    fixture.detectChanges();
    component = fixture.componentInstance;
    component['edits'][d.id] = edit;
  };

  it('publishes a clean draft after the plain confirm', async () => {
    setUp(draft(), 'Saved copy');
    await component.publish(draft());
    expect(confirm.ask.calls.mostRecent().args[0].message).toBe(en['social.confirmPublish.message']);
    expect(calls).toEqual(['publish']);
  });

  it('saves unsaved edits first, then publishes, and the dialog says so', async () => {
    setUp(draft(), 'Edited copy');
    await component.publish(draft());
    expect(confirm.ask.calls.mostRecent().args[0].message).toBe(en['social.confirmPublish.messageUnsaved']);
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

  it('has the new strings in both languages', () => {
    for (const key of ['social.confirmPublish.messageUnsaved', 'social.errors.publishEmpty']) {
      expect(en[key]).withContext(key).toBeTruthy();
      expect(ptPT[key]).withContext(key).toBeTruthy();
    }
  });
});
