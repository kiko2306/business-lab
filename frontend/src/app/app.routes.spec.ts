import { Route } from '@angular/router';
import { routes } from './app.routes';

// plan.md §841 fix 3: /utils is gone. Bookmarks and old links still land
// somewhere useful (Home, where the health read-out now lives).
describe('routes', () => {
  const children = (routes.find((r) => r.component)?.children ?? []) as Route[];

  it('sends /utils to Home instead of a page', () => {
    const utils = children.find((r) => r.path === 'utils');
    expect(utils?.redirectTo).toBe('home');
    expect(utils?.loadComponent).toBeUndefined();
  });
});
