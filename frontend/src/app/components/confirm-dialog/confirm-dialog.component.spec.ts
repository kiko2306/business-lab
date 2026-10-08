import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmService } from '../../core/confirm.service';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
    imports: [ConfirmDialogComponent],
    template: `
    <button id="opener" type="button">Delete</button>
    <input id="behind" type="text" />
    <app-confirm-dialog />
  `
})
class HostComponent {}

// plan.md §813: the one confirm modal every destructive action in the app goes
// through was `aria-modal` only. Focus stayed behind it (the `autofocus` on a
// button created after load is ignored), Tab walked the page underneath, and a
// *document-level* Enter confirmed whatever the dialog was asking — so Enter
// pressed anywhere, with focus on a page control, could delete a user.
describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let confirm: ConfirmService;
  const q = (selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement;
  const key = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

  async function open(danger = true): Promise<{ answer: Promise<boolean>; settled: () => boolean | undefined }> {
    let result: boolean | undefined;
    const answer = confirm.ask({ title: 'Delete user', message: 'Delete ana?', danger }).then((value) => (result = value));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { answer, settled: () => result };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    confirm = TestBed.inject(ConfirmService);
    fixture.detectChanges();
    q('#opener').focus();
  });

  it('moves focus into the dialog when it opens', async () => {
    await open();
    expect(q('.confirm-dialog').contains(document.activeElement)).toBeTrue();
  });

  it('keeps Tab inside the dialog, wrapping from the last control to the first', async () => {
    await open();
    const buttons = q('.confirm-foot').querySelectorAll('button');
    buttons[buttons.length - 1].focus();
    key(buttons[buttons.length - 1], 'Tab');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('does not confirm when Enter is pressed with focus on the page behind it', async () => {
    const { settled } = await open();
    q('#behind').focus();
    key(q('#behind'), 'Enter');
    await Promise.resolve();
    expect(settled()).toBeUndefined();
    expect(q('.confirm-dialog')).not.toBeNull();
  });

  it('confirms when Enter activates the focused confirm button', async () => {
    const { answer } = await open();
    (q('.confirm-foot .btn-danger') as HTMLButtonElement).click();
    expect(await answer).toBeTrue();
  });

  it('answers no on Escape and gives focus back to what opened it', async () => {
    const { answer } = await open();
    key(document.body, 'Escape');
    expect(await answer).toBeFalse();
    fixture.detectChanges();
    expect(document.activeElement).toBe(q('#opener'));
  });
});
