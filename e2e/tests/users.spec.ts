import { test, expect } from '@playwright/test';
import { ADMIN, expandPanel } from './helpers';

// The invite-based user flow (plan.md §158): with no shared mailbox
// configured the Add-user form warns and its submit is disabled, and the
// first admin shows up in the accounts table.
test.describe('Users & roles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Users & roles', level: 1 })).toBeVisible();
  });

  test('the add-user form is gated on a configured mailbox', async ({ page }) => {
    await expandPanel(page, 'Add user');
    await expect(page.getByText('the shared mailbox has to be set up first')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create user .* send invite/ })).toBeDisabled();
  });

  test('the first admin is listed', async ({ page }) => {
    await expandPanel(page, 'Accounts');
    const row = page.getByRole('row', { name: new RegExp(`\\b${ADMIN.username}\\b`) });
    await expect(row).toBeVisible();
    await expect(row.getByText('you', { exact: true })).toBeVisible();
  });
});
