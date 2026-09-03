import { test, expect } from '@playwright/test';

// Every page in the authenticated shell should load from its nav link and
// show its own heading. A broken route guard or a missing capability shows
// up here as a redirect back to /home.
const PAGES: { link: string; url: string; heading: string }[] = [
  { link: 'Apps', url: '**/apps', heading: 'Apps' },
  { link: 'Backups', url: '**/backups', heading: 'Backups & restore' },
  { link: 'Exposure', url: '**/exposure', heading: 'Exposure & networking' },
  { link: 'Settings', url: '**/settings', heading: 'Settings' },
  { link: 'Utils', url: '**/utils', heading: 'Utils' },
  { link: 'Users & roles', url: '**/users', heading: 'Users & roles' },
  { link: 'Audit logs', url: '**/audit-logs', heading: 'Audit logs' },
  { link: 'Security', url: '**/account', heading: 'Account security' },
];

test.beforeEach(async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Menu', level: 1 })).toBeVisible();
});

for (const { link, url, heading } of PAGES) {
  test(`the ${link} page loads from its nav link`, async ({ page }) => {
    await page.getByRole('link', { name: link, exact: true }).click();
    await page.waitForURL(url);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  });
}

test('logging out returns to the sign-in screen', async ({ page }) => {
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.waitForURL('**/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
