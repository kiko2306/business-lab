import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FieldErrorDirective } from './field-error.directive';

@Component({
  standalone: true,
  imports: [FieldErrorDirective],
  template: `
    <label for="smtpHost">Mail server</label>
    <input id="smtpHost" />
    @if (invalid) {
      <div class="form-text text-danger" appFieldError="smtpHost">Enter a hostname.</div>
    }
  `,
})
class HostComponent {
  invalid = false;
}

describe('FieldErrorDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  const control = () => element.querySelector('#smtpHost') as HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  it('leaves a valid field alone', () => {
    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();
  });

  // Sighted users get red text under the input. Without this, someone on a
  // screen reader tabs into the field, hears the label, and gets nothing —
  // the message is an unconnected text node beside it.
  it('points the field at its message, and marks it invalid', () => {
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();

    const message = element.querySelector('.text-danger') as HTMLElement;
    expect(message.id).toBe('smtpHost-error');
    expect(control().getAttribute('aria-describedby')).toBe('smtpHost-error');
    expect(control().getAttribute('aria-invalid')).toBe('true');
  });

  it('announces the message when it appears', () => {
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();
    expect((element.querySelector('.text-danger') as HTMLElement).getAttribute('role')).toBe('alert');
  });

  it('clears both attributes once the field is valid again', () => {
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();
    fixture.componentInstance.invalid = false;
    fixture.detectChanges();

    expect(control().getAttribute('aria-invalid')).toBeNull();
    expect(control().getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps any describedby the field already had', () => {
    control().setAttribute('aria-describedby', 'smtpHost-hint');
    fixture.componentInstance.invalid = true;
    fixture.detectChanges();
    expect(control().getAttribute('aria-describedby')).toBe('smtpHost-hint smtpHost-error');

    fixture.componentInstance.invalid = false;
    fixture.detectChanges();
    expect(control().getAttribute('aria-describedby')).toBe('smtpHost-hint');
  });
});
