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
    expect(text).toContain('did not answer');
  });

  it('says so when the browser is offline', async () => {
    const { fixture, element } = await build(of([]));
    window.dispatchEvent(new Event('offline'));
    fixture.detectChanges();
    expect(element.textContent).toContain('You are offline');
    window.dispatchEvent(new Event('online'));
  });
});
