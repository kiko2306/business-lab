import path from 'node:path';
import { expect, type Page } from '@playwright/test';

// The first-admin credentials. docker-compose.test.yml starts with an empty
// database, so auth.setup.ts creates this account; a live run reuses whatever
// is passed in.
export const ADMIN = {
  username: process.env.E2E_ADMIN_USER ?? 'admin',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'AdminPassword-123',
};

export const STATE_PATH = path.join(__dirname, '.auth', 'state.json');

/**
 * Every page's content lives in <app-panel> cards that are collapsed by
 * default (SectionCollapseService). Click a panel's header to reveal its
 * body; no-op if it is already open.
 */
export async function expandPanel(page: Page, title: string): Promise<void> {
  const toggle = page.locator('.panel__toggle', { hasText: title });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
}
