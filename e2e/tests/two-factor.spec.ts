import { test, expect } from '@playwright/test';
import { authenticator } from 'otplib';
import { ADMIN, expandPanel } from './helpers';

const PANEL = 'Two-factor authentication (TOTP)';

// A TOTP code that won't roll over mid-request. The backend accepts ±1 step,
// but generating right on the boundary is still flaky, so wait for a fresh
// window when the current one is nearly done.
function freshToken(secret: string): string {
  if (authenticator.timeRemaining() < 5) {
    // Busy-wait the last few seconds of the step — cheaper than plumbing a
    // timer through Playwright's test runner.
    const until = Date.now() + authenticator.timeRemaining() * 1000 + 500;
    while (Date.now() < until) {
      /* spin */
    }
  }
  return authenticator.generate(secret);
}

// Full second-factor journey: enrol from Account security, then sign out and
// back in through the MFA challenge, then turn it off again so the suite is
// left as it started.
test('enrol, sign in with a code, then disable TOTP', async ({ page }) => {
  // The busy-wait in freshToken() can burn most of a 30s TOTP step, and this
  // test needs three separate codes.
  test.setTimeout(120_000);

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account security', level: 1 })).toBeVisible();
  await expandPanel(page, PANEL);

  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();

  const secret = (await page.locator('code.user-select-all').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  await page.getByLabel('Enter the 6-digit code to confirm').fill(freshToken(secret));
  await page.getByRole('button', { name: 'Activate' }).click();

  await expect(page.getByText('Two-factor authentication is now on')).toBeVisible();
  // The button label uses a typographic apostrophe (I’ve), so match loosely.
  await page.getByRole('button', { name: /saved them/ }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();

  // Sign out and back in — the credentials step should now hand off to the
  // MFA challenge before it lands on the dashboard.
  await page.getByRole('button', { name: 'Logout' }).click();
  await page.waitForURL('**/login');

  await page.getByLabel('Email / username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  await page.getByLabel('Authentication code').fill(freshToken(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/home');

  // Turn it back off with a current code, so the suite is left as it started.
  await page.goto('/account');
  await expandPanel(page, PANEL);
  const disableForm = page.locator('form', {
    has: page.getByRole('button', { name: 'Disable two-factor authentication' }),
  });
  await disableForm.getByPlaceholder('123456').fill(freshToken(secret));
  await disableForm.getByRole('button', { name: 'Disable two-factor authentication' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
});
