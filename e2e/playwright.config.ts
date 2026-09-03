import { defineConfig, devices } from '@playwright/test';

// The dashboard the tests drive. Defaults to the frontend published by
// docker-compose.test.yml (see scripts/e2e-tests.sh); point it at a live
// deployment to run the same specs against the real stack.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:18080';

export default defineConfig({
  testDir: './tests',
  // The suite shares one dashboard and one database (the first-admin account
  // is created once, in auth.setup.ts). Parallel workers would race on it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      // Creates (or signs into) the first admin and saves its session, so
      // the spec files start already authenticated.
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/state.json',
      },
    },
  ],
});
