import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { StoresComponent } from './stores.component';
import { ApiService } from '../api.service';

describe('StoresComponent third pass (plan.md §806.8)', () => {
  const build = async (list: unknown) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage']);
    api.listStores.and.returnValue(list as never);
    api.me.and.returnValue(of({ user: 'owner', isAdmin: false }) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    await TestBed.configureTestingModule({
      imports: [StoresComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StoresComponent);
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  };

  // The Shops page printed whatever the response body said — "x", or a stack
  // trace — where the shop page had already learned to write a sentence.
  it('writes a failure as a sentence, not the response body', async () => {
    const { element } = await build(throwError(() => ({ status: 500, error: { error: 'ECONNRESET at relay' } })));
    const text = element.querySelector('.alert-danger')!.textContent!;
    expect(text).not.toContain('ECONNRESET');
    expect(text).toContain('could not be loaded');
  });

  it('says so when the browser is offline', async () => {
    const { fixture, element } = await build(of([]));
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    expect(element.textContent).toContain('You are offline');
    window.dispatchEvent(new Event('online'));
  });
});

describe('StoresComponent fourth pass (plan.md §810)', () => {
  const build = async (me: unknown, list: unknown) => {
    const api = jasmine.createSpyObj('ApiService', ['listStores', 'me', 'agentPackage']);
    api.listStores.and.returnValue(list as never);
    api.me.and.returnValue(of(me) as never);
    api.agentPackage.and.returnValue(of(null) as never);
    await TestBed.configureTestingModule({
      imports: [StoresComponent],
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(StoresComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const two = [
    { id: 'a', name: 'A', isActive: true, agentEnrolled: true, connected: true, lastSeenAt: null, agentVersion: '1.4.0' },
    { id: 'b', name: 'B', isActive: true, agentEnrolled: true, connected: true, lastSeenAt: null, agentVersion: '1.4.0' },
  ];

  it('says the list failed, not that "the shop" did not answer, and draws no empty table', async () => {
    const el = await build({ user: 'x', isAdmin: true }, throwError(() => ({ status: 500, error: {} })));
    const text = el.querySelector('.alert-danger')!.textContent!;
    expect(text).toContain('list');
    expect(text).not.toContain('shop did not answer');
    expect(el.querySelector('table')).toBeNull();
  });

  it('keeps operator columns off a viewer’s list', async () => {
    const el = await build({ user: 'x', isAdmin: false }, of(two));
    const headers = Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent?.trim());
    expect(headers).not.toContain('Version');
    expect(headers).toContain('Shop');
  });

  it('keeps them for an admin, with Delete apart from Open', async () => {
    const el = await build({ user: 'x', isAdmin: true }, of(two));
    expect(Array.from(el.querySelectorAll('thead th')).map((h) => h.textContent?.trim())).toContain('Version');
    const del = el.querySelector('.btn-outline-danger')!;
    expect(del.closest('.btn-group')).not.toBe(el.querySelector('a.btn-outline-primary')!.closest('.btn-group'));
  });
});
