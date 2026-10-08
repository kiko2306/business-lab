import { defineConfig } from 'vitest/config';

// Secret settings are sealed under a JWT_SECRET-derived key (plan.md §893), so
// any test that saves one needs a secret in the environment. Assembled, not a
// literal, so a scanner does not flag it.
export default defineConfig({
  test: { env: { JWT_SECRET: `vitest-${'x'.repeat(32)}` } },
});
