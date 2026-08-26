// Must be the very first import in src/index.ts. dotenv is optional in the
// containerized runtime, where env vars are injected directly, so a missing
// package or .env file here is not fatal.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  // No .env file / dotenv not installed — env vars are expected to be set directly.
}

export {};
