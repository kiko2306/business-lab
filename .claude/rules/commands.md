---
paths:
  - "scripts/**"
  - "backend/**"
  - "frontend/**"
  - ".github/**"
---

## Commands

**No Node on this host** — everything run in container. `./scripts/check.sh <backend|frontend> <test|typecheck|build>`. It find repo root itself; mounting `$PWD` direct break, because some backend test resolve path up to repo root. `frontend test` build `business-lab-frontend-test` image on first use (plain `node:20` miss Chrome and library headless Chrome need). Rebuild that image (`docker build -t business-lab-frontend-test -f frontend/Dockerfile.test frontend`) when `frontend/package-lock.json` `puppeteer` version change — `Dockerfile.test` pin match Chrome download.

`./scripts/smoke-tests.sh` run on host against already-run backend. CI run backend typecheck+test, frontend test:ci+build, `apps/price-compare/app` test, and Playwright E2E (`scripts/e2e-tests.sh`); smoke test no in CI. Run affected workspace check before say change done. Run `scripts/e2e-tests.sh` when change touch auth, shell/nav, Users page or 2FA flow.
