import { test, expect } from '@playwright/test';

// The dashboard ships a strict Content-Security-Policy (frontend/nginx.conf,
// plan.md §522). A violation rarely breaks a page outright — a style,
// request or worker just silently doesn't load — so fail loudly on any
// report the browser logs while every shell page renders.
const PAGES = ['/home', '/apps', '/backups', '/settings', '/content', '/utils', '/audit-logs', '/users', '/updates', '/account'];

test('the shell pages load with no Content-Security-Policy violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });

  // Guard against passing vacuously: the policy must actually be served.
  const response = await page.goto('/home');
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");

  for (const path of PAGES) {
    await page.goto(path);
    // Not 'networkidle': the shell holds a realtime stream open, so it never is.
    await expect(page.locator('h1').first()).toBeVisible();
  }

  expect(violations).toEqual([]);
});
