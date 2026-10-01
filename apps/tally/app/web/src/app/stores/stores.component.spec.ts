import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StoresComponent } from './stores.component';
import { ApiService } from '../api.service';

describe('StoresComponent', () => {
  let fixture: ComponentFixture<StoresComponent>;
  let element: HTMLElement;

  const build = async ({ fail = false, isAdmin = true } = {}) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage']);
    api.listStores.and.returnValue((fail ? throwError(() => ({ status: 404, error: {} })) : of([])) as never);
    api.me.and.returnValue(of({ user: 'owner', isAdmin }) as never);
    api.agentPackage.and.returnValue(of(null) as never);

    await TestBed.configureTestingModule({
      imports: [StoresComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(StoresComponent);
    element = fixture.nativeElement;
    fixture.detectChanges();
  };

  // Measured in a browser during the critique: with the API unreachable the
  // page showed "Request failed (404)" *and* "No shops yet. Add one above",
  // so a transport failure read as data loss (plan.md §806).
  it('does not claim the shop list is empty when the request failed', async () => {
    await build({ fail: true });
    expect(element.querySelector('.alert-danger')).not.toBeNull();
    expect(element.textContent).not.toContain('No shops yet');
  });

  it('still shows the empty state when the list really is empty', async () => {
    await build();
    expect(element.textContent).toContain('No shops yet');
  });

  // "Add one above" pointed at a form inside @if (isAdmin), so a non-admin was
  // told to use a control that was not on the page.
  it('tells a non-admin who can add a shop instead of telling them to', async () => {
    await build({ isAdmin: false });
    expect(element.textContent).toContain('No shops yet');
    expect(element.textContent).not.toContain('Add one above');
  });

  it('names every input', async () => {
    await build();
    const unnamed = Array.from(element.querySelectorAll('input, select, textarea')).filter((control) => {
      if (control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return false;
      if (control.closest('label')) return false;
      const id = control.getAttribute('id');
      return !(id && element.querySelector(`label[for="${id}"]`));
    });
    expect(unnamed.map((c) => c.getAttribute('name') ?? c.tagName)).toEqual([]);
  });
});
