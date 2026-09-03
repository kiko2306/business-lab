import fs from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { ADMIN, STATE_PATH } from './helpers';

// Runs before every spec (Playwright "setup" project). On the throwaway test
// stack this creates the first admin; against a live stack — or a re-run
// against a test DB that already has one — it signs in instead. Either way it
// leaves a saved session the spec files load via storageState.
setup('create the first admin, or sign in, and save the session', async ({ page, request }) => {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });

  // Ask the backend rather than racing the client-side guard redirect.
  const status = await request.get('/api/auth/setup-status');
  const { setupRequired } = (await status.json()) as { setupRequired?: boolean };

  if (setupRequired) {
    await page.goto('/setup');
    await page.getByLabel('Username').fill(ADMIN.username);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByLabel('Confirm password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Create administrator' }).click();
  } else {
    await page.goto('/login');
    await page.getByLabel('Email / username').fill(ADMIN.username);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  await page.waitForURL('**/home');
  await expect(page.getByText(`Signed in as ${ADMIN.username}`)).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});
