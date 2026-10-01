import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { provideRouter } from '@angular/router';

// The first spec in this workspace: `apps/tally/app/web` shipped a `test`
// script with no specs and no Karma, so nothing here was testable and CI ran
// only the api job (plan.md §806). This one exists to prove the harness runs;
// the real coverage follows it.
describe('tally-web test harness', () => {
  it('renders the shell', async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.navbar-brand')?.textContent).toContain('Tally');
  });
});
