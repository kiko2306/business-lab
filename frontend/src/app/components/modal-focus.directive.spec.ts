import { NgIf } from '@angular/common';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalFocusDirective } from './modal-focus.directive';

@Component({
  standalone: true,
  imports: [NgIf, ModalFocusDirective],
  template: `
    <button id="opener" type="button">open</button>
    <div *ngIf="open" id="dialog" appModalFocus [dismissible]="dismissible" (dismiss)="dismissed = dismissed + 1">
      <button id="first" type="button">first</button>
      <button id="last" type="button">last</button>
    </div>
  `,
})
class HostComponent {
  open = false;
  dismissible = true;
  dismissed = 0;
}

// plan.md §776: aria-modal alone does not trap focus. The Backups dialogs
// (restore, run, restart) had no initial focus, no Tab trap and no Escape.
describe('ModalFocusDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const q = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
  const key = (target: HTMLElement, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    q('opener').focus();
    host.open = true;
    fixture.detectChanges();
  });

  it('moves focus into the dialog when it opens, and back to what opened it on close', () => {
    expect(document.activeElement).toBe(q('dialog'));
    expect(q('dialog').getAttribute('tabindex')).toBe('-1');
    host.open = false;
    fixture.detectChanges();
    expect(document.activeElement).toBe(q('opener'));
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    q('last').focus();
    key(q('last'), { key: 'Tab' });
    expect(document.activeElement).toBe(q('first'));
    key(q('first'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(q('last'));
  });

  it('dismisses on Escape only while the dialog says it can be dismissed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.dismissed).toBe(1);
    host.dismissible = false;
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.dismissed).toBe(1);
  });
});
