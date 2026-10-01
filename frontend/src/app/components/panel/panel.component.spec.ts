import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PanelComponent } from './panel.component';

describe('PanelComponent', () => {
  let fixture: ComponentFixture<PanelComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PanelComponent] }).compileComponents();
    fixture = TestBed.createComponent(PanelComponent);
    fixture.componentRef.setInput('key', 'backups:schedule');
    fixture.componentRef.setInput('title', 'Backup schedule');
    fixture.componentRef.setInput('subtitle', 'When the box backs itself up');
    fixture.detectChanges();
  });

  // Panels are the structure of Settings, Backups, Utils and Audit logs. As
  // plain spans they contributed nothing to the document outline, so heading
  // navigation — the way a screen-reader user moves through a long page —
  // found only the page's own h1, and the h3s inside the panels skipped a level.
  it('renders the title as a real heading, one level under the page title', () => {
    const heading = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(heading).not.toBeNull();
    expect(heading.textContent).toContain('Backup schedule');
  });

  it('keeps the toggle a button inside that heading, with its expanded state', () => {
    const button = fixture.nativeElement.querySelector('h2 button.panel__toggle') as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the panel body after the heading, not inside it', () => {
    const heading = fixture.nativeElement.querySelector('h2') as HTMLElement;
    expect(heading.querySelector('.panel__body')).toBeNull();
  });
});
