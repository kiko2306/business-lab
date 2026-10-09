# Business Lab

**Version 0.171.1** — full history in the [changelog](/CHANGELOG.md).

Business Lab (repository `business-lab`) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

## What it is, and how it's sold

Business Lab — the software in this repository — is **free to use**. There are
no tiers, no subscription, and no hosted multi-tenant service: one deployment
is one client, who owns the box and runs it on their own domain, Cloudflare
account and user set, for their own internal business.

What is sold is **service, not software**:

- **Domain management** — the Cloudflare account, DNS, the Tunnel and Zero
  Trust policies (the [webmaster runbook](/docs/webmaster.md)).
- **Custom configuration** — standing up the app set a given office needs and
  wiring it to their accounts and data.
- **Server maintenance** — keeping the stack patched, backed up and healthy
  (the [IT administrator runbook](/docs/it-admin.md)).

Turnkey hardware — a pre-built box — may be sold alongside that service. The
apps are never resold or run as a service for third parties; each client
operates their own instance. Bundled features such as document management
and OCR are part of the free software, not a paid add-on.

This supersedes the "three tiers, only one of which is free" and "which SaaS
each app replaces" framing in earlier `plan.md` sections (§84.2, §84.4). The
licence due diligence in [docs/licences.md](/docs/licences.md) is checked
against this model.

## Documentation

- Setup guide: [/docs/setup-guide.md](/docs/setup-guide.md)
- First run — prerequisites, prompts, what's reachable: [/docs/first-run.md](/docs/first-run.md)
- First login per app: [/docs/app-credentials.md](/docs/app-credentials.md)
- Host ports: [/docs/ports.md](/docs/ports.md)
- Raspberry Pi / arm64 guide: [/docs/raspberry-pi.md](/docs/raspberry-pi.md)
- Deployment guide — provisioning a box for a client, first run to hand-over: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- Turnkey build spec — hardware, disk partitioning, the default small-office app profile: [/docs/turnkey-build-spec.md](/docs/turnkey-build-spec.md)
- Data protection position — controller vs processor, backup key custody, the DR promise: [/docs/data-protection-position.md](/docs/data-protection-position.md)
- Commercial plan — pricing structure, onboarding timeline, support model: [/docs/commercial-plan.md](/docs/commercial-plan.md)
- API reference (OpenAPI, partial — auth, services, settings and users, not every route): [/docs/openapi.yaml](/docs/openapi.yaml)
- Recovery & troubleshooting: [/docs/recovery-troubleshooting.md](/docs/recovery-troubleshooting.md)
- Two-factor authentication (TOTP) for the dashboard login: [/docs/two-factor.md](/docs/two-factor.md)
- Licence due diligence (every image vs the resale model): [/docs/licences.md](/docs/licences.md)
- Sales catalogue (what each app replaces): [/docs/sales-catalogue.md](/docs/sales-catalogue.md)
- Sequence diagrams for the three multi-service backend actions (open with
  [app.diagrams.net](https://app.diagrams.net) or the desktop app):
  [exposure provisioning](/docs/exposure-provisioning.drawio),
  [the self-update walk](/docs/self-update-walk.drawio),
  [the backup/restore round trip](/docs/backup-restore-roundtrip.drawio)
- Version history: [/CHANGELOG.md](/CHANGELOG.md)
- User guide: [/docs/user-guide.md](/docs/user-guide.md)
- Webmaster runbook (Cloudflare / DNS / Tunnel): [/docs/webmaster.md](/docs/webmaster.md)
- IT administrator runbook (running the stack): [/docs/it-admin.md](/docs/it-admin.md)
- Development guide: [/docs/development-guide.md](/docs/development-guide.md)
- SSH key access: [/docs/ssh-keys.md](/docs/ssh-keys.md)
- Security checklist: [/docs/security-checklist.md](/docs/security-checklist.md)

## Quick start

```bash
git clone <this repo> && cd business-lab
sudo ./start.sh
```

That's it — on Ubuntu/Debian, `start.sh` installs Docker (via the official
`get.docker.com` script) and the Compose plugin if they're not already
present, enables the docker service, and adds the user who ran `sudo` to the
`docker` group. It then generates `.env` on first run (random `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`; `APPS_DIR` and `DOCKER_GID`
auto-detected), builds the images, and starts the stack. `sudo` is required
because it installs system packages and manages the docker service. It's
safe to re-run any time (e.g. after `git pull`) — it never overwrites a
secret that's already set, and never reinstalls Docker if it's already
there.

Open the printed dashboard URL and complete `/setup` to create the first
admin account. From there, per-app secrets are entered in the dashboard; no
more manual `.env` editing is required for the core app. Every app that can be
exposed is published behind Authelia automatically on its next start — there
is no per-app exposure step.

<details>
<summary>Manual setup (if you'd rather not run the script)</summary>

1. Copy `.env.example` to `.env` and set secure values (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`).
2. Set `APPS_DIR` to the **absolute** path of this repository's `apps/` directory, and `DOCKER_GID` to the docker socket's owning group id:
   ```bash
   echo "APPS_DIR=$PWD/apps" >> .env
   echo "DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)" >> .env
   ```
3. Start services:
   ```bash
   docker compose up -d --build
   ```
4. Open the frontend at `http://localhost:${FRONTEND_PORT:-80}`.
5. If first run, complete `/setup` to create the first admin account.

</details>

## Folder structure

The folders a user or operator actually needs to open — internal code
directories are covered in `CLAUDE.md` instead. Add a row here only when a
new top-level folder is something a user/operator would navigate to, not
every new directory.

| Path | What |
|---|---|
| `apps/<name>/` | One Docker Compose stack per managed app — its `.env` and data live here (gitignored). |
| `docs/` | Operator docs — setup, credentials, ports, runbooks, licence due diligence. |
| `frontend/` | The Angular dashboard. |
| `backend/` | The Node/Express API that drives Docker on the dashboard's behalf. |
| `start.sh` | The one command a human runs on the host — see Quick start above. |

## Managed app stacks

Each app under `apps/<name>/` is an independent Docker Compose stack that the
backend starts and stops on your behalf.

- `APPS_DIR` is bind-mounted into the backend at the *same absolute path* as
  on the host, so relative paths inside an app's compose file resolve
  identically inside and outside the container. It's mounted **read-write**
  so the dashboard can write each app's `.env` for you (see below) — combined
  with the Docker access below, the backend already has root-equivalent
  host control, so this isn't a materially larger trust boundary.
- The backend does **not** mount the host Docker socket. A `docker-socket-proxy`
  service holds the real socket and the backend reaches it over
  `DOCKER_HOST=tcp://docker-socket-proxy:2375`, on the internal network only,
  scoped to what `docker ps` and `docker compose up|down` need — `exec`,
  `build`, `secrets`, `swarm` and `plugins` stay off. That narrows the blast
  radius but does not sandbox compose: creating containers is still creating
  containers, so **treat the backend as root-equivalent on the host** and only
  expose the API to trusted users.
- Apps with required secrets ship a `.env.example` documenting them, but you
  don't need to touch it by hand: open the service's card on the dashboard,
  expand **Configuration**, fill in the required (`*`) fields, and save. The
  backend creates `apps/<name>/.env` from `.env.example` on first save and
  updates it from there — secret-looking keys (`PASSWORD`/`SECRET`/`TOKEN`/`*_KEY`)
  are write-only in the UI, never echoed back, only reported as "configured"
  or not.
  `start.sh` sets up the directory permissions this needs automatically; the
  manual `chgrp`/`chmod` dance is only needed if you set up `apps/` by some
  other means.
- Apps listed in the registry without a directory in `apps/` report as `unknown`
  and return HTTP 404 when started.

## Validation and smoke tests

- Smoke tests against a running backend:
  ```bash
  ./scripts/smoke-tests.sh
  ```
- Dockerized E2E deployment test:
  ```bash
  ./scripts/docker-e2e-test.sh
  ```
- Browser E2E — Playwright drives the real dashboard (login, navigation, the
  invite-gated Users page, the full TOTP second-factor journey). Runs in
  containers, no host Node, and is its own CI job:
  ```bash
  ./scripts/e2e-tests.sh
  ```
  The specs in `e2e/tests/` also run against a live deployment — point
  `E2E_BASE_URL` at it and run `npx playwright test` from `e2e/`.
- Live-stack E2E — `e2e/tests/live-stack.spec.ts` covers the flows the
  socket-less test stack can't (start/stop an app, the Backups page, the
  Exposure test-connection check). Opt-in and local-only, so CI skips it:
  ```bash
  E2E_LIVE_STACK=1 E2E_BASE_URL=https://your-dashboard \
  E2E_ADMIN_USER=admin E2E_ADMIN_PASSWORD=… \
  npx playwright test live-stack   # from e2e/
  ```
  Optionally set `E2E_LIVE_APP` (default `samba`) to the app it bounces.

## Project status

Working and proven against the real deployment: authenticated start/stop with
per-app config written from the dashboard, public exposure (Cloudflare Tunnel +
Nginx Proxy Manager) with upstreams derived automatically, Authelia SSO in front
of exposed apps, NetBird VPN with peers connected, app database dumps, and
backup + restore verified byte-identical.

`plan.md` is the running spec and session log — every change, including what was
tried and rejected, is recorded there in numbered sections. Read its last section
for where things stand.

## Environments

The deployment this repo is developed against, `tx-home-utils.com`, is a
**dev/test box with no uptime or data-durability guarantee** — services may go
down and data may be changed or lost. It exists to prove changes against a real
stack; anything on it is disposable.

A production / per-client deployment is a **separate install** with its own
domain and its own credentials and tokens, where uptime and data *do* matter.
It uses the same internet-exposure model (Cloudflare Tunnel + Nginx Proxy
Manager), so being reachable from the internet is not what distinguishes the
two — the guarantees are.

## TODO

**This list is the single place open work is tracked.** An item is deleted when
it is done — not ticked off and left behind. Section references point at
`plan.md`.

### 🔴 URGENT — review remainder (plan.md §889)

The fourteen findings of the 2026-10-08 review that have not landed, all marked urgent by the
owner. Listed most-severe first, which is the order to take them in. Each was re-verified
against the tree at `0.167.1`. Test first, own commit and version bump each; delete an item when
its fix lands (a fix still needing a `beta` look leaves its own beta item behind).

- [ ] **Beta-test the nginx backend re-resolve (plan.md §897)** — on `beta`, after the update rebuilds
      the frontend: open the dashboard and sign in. Then recreate only the backend
      (`docker compose up -d --force-recreate backend` on the host) and, within ~15 seconds and with
      no frontend restart, reload the dashboard: login and `/api` calls must work, not 502. Live
      status (WebSocket, `/ws/services`) must reconnect too.
- [ ] **Beta-test sealed third-party secrets (plan.md §893)** — on `beta`, after the update: test the
      Cloudflare token, send a test email, run an AI-backed action, test the NPM connection and save
      the exposure settings, and run a backup to a password-protected target. Each has to still
      authenticate, and the Settings page must still show the masked value, not ciphertext. Backend logs must
      show no "Unable to seal stored third-party secrets" line at boot.
- [ ] **Beta-test nodemailer 10 (plan.md §892)** — on `beta`, after the update rebuilds the backend:
      send a test email from Settings, invite a user and confirm the set-password link arrives,
      and check the backup/alert mails still send.
- [ ] **Beta-test Angular 21 (plan.md §898)** — on `beta`, after the update rebuilds the frontend: every
      page loads and its forms work (Home, Apps, Backups, Users, Settings, Update, Account, Audit log,
      login with and without 2FA); the service worker updates rather than serving a stale shell (hard
      reload twice, check the new bundle hash loads); the browser console reports no CSP violation
      and no `NG0100` error on Home; live status (WebSocket) still updates.
- [ ] **Beta-test the app workspaces on Angular 21 (plan.md §906)** — on `beta`, after the update
      rebuilds Hotel and Tally: open Check-in (guest form submits), Pulse and Hotel admin (each
      loads, signs in, shows data), and the Tally web app (day view, language switch). No console
      errors; the pages look unchanged.
- [ ] **Beta-test the narrowed host-disk mount (plan.md §905)** — on `beta`, after the update
      recreates the backend: Home/Utils health still shows a "system" disk row with a sensible
      percentage (or one merged row while Docker and root share a filesystem), and on the host
      `docker compose exec backend ls /hostfs` shows only `os-release`.
- [ ] **Beta-test per-service post-start reconcilers (plan.md §901)** — on `beta`, after the update
      rebuilds the backend: restart ITFlow and Uptime Kuma from the Apps page and confirm their
      first-admin, mail/cron and monitor wiring still land (backend log shows no "Post-start
      reconciler … failed"), and that starting an app with no reconciler (e.g. whoami) still
      succeeds.
### Review batch 3, 2026-10-08 (plan.md §884)

Infrastructure robustness, five items. Three touch Docker or nginx, so they need a real look.

- [ ] **Beta-test the pinned socket proxy (plan.md §884 item 1)** — on `beta`, after the update:
      `docker ps` shows both `docker-socket-proxy` and `watchdog-docker-proxy` running on
      `tecnativa/docker-socket-proxy:v0.5.0`, and the dashboard still starts and stops an app
      (that is the backend's whole Docker path going through the first one). Trigger an update
      from the Update page and confirm it completes — the watchdog's proxy is the one that path
      leans on.
- [ ] **Beta-test that the stack serves nothing before its schema is ready (plan.md §884 item
      3)** — on `beta`, restart the backend and reload the dashboard immediately: you should get
      either a clean load or a connection refused, never a page with errors about missing tables.
      The backend log should show the schema lines before "listening on port".
- [ ] **Beta-test nginx connection reuse (plan.md §884 item 5)** — on `beta`, open the Apps page
      and leave it a few minutes: live status still arrives within ~15 s of a start (that is the
      WebSocket upgrade, which must still work), a startup-log stream still runs to the end, and
      ordinary pages (Users, Settings, Backups) still load. Then upload something oversized if
      you can — a config save with a very long value — and confirm the message says the request
      was too large rather than showing a server error.

### Review batch 2, 2026-10-08 (plan.md §879)

The security remainder of the same review, four items, each its own commit and version bump.

- [ ] **Beta-test the access-token purpose claim (plan.md §879 item 1)** — on `beta`, keep a
      tab signed in *across* the update, then click around: every access token issued before
      the change is now rejected, so the first request 401s and the app spends its refresh token
      for a new one behind the scenes. You should **not** be signed out and should see no error —
      if you land on the sign-in screen, that silent refresh is broken. Then leave a tab open for
      over an hour and confirm it still works (the same refresh, on the normal hourly schedule),
      sign in once with 2FA, and use **Sign out** and confirm the next page load asks for a
      password.
- [ ] **Beta-test the live-status stream after the ticket change (plan.md §879 item 2)** — on
      `beta`, open the Apps page: the cards flip to Running within ~15 s of a start without a
      manual refresh (that is the WebSocket, or the SSE fallback, authenticating with a ticket).
      Start an app and watch its startup log stream to the end. Both in two tabs at once.
- [ ] **Beta-test the one-account-per-email rule (plan.md §879 item 3)** — on `beta`: create a
      user, then try to create a second with the same address, and with the same address in a
      different case (`Ana@…` vs `ana@…`) — both refused with a clear message, not a 500. Then
      open **Edit access** on an existing account and try to change its email to one another
      account already holds: also refused. Check the backend log on startup names no problem
      with the email index; if it says it could not create it, there are already duplicates on
      that box and they need merging by hand.
- [ ] **Beta-test that recovery mode still works (plan.md §879 item 4)** — on `beta`, on the
      host: `./start.sh recover` still resets a locked-out admin (that path never used HTTP).
      Then open `/recovery` in a browser over the public hostname and confirm it still says
      recovery is not available from there rather than offering the form.

### Review batch, 2026-10-08 (plan.md §873)

Four items from a whole-repo review, run in this order, each its own commit and version bump.

- [ ] **Stop an admin promoting itself to webmaster (plan.md §873 item 1)** — on `beta`, sign in
      as an `admin` (not a webmaster) and try, over the API and in the UI: **Edit roles** on another
      account offering Full admin, and **Reset password** on the webmaster's own row. Both must be
      refused with a clear message, and the webmaster's own Edit roles / Reset password on that same
      admin must still work. Then check an admin can still create, edit and delete ordinary accounts.
- [ ] **Beta-test the dependency bumps (plan.md §873 item 2)** — `proxy-addr`, `joi` and `qs`.
      On `beta`, after the update: sign in (2FA too, if enrolled), save Settings with a deliberately
      bad value and confirm the 422 still names the field, and check the Audit Logs page shows your
      real client IP for a LAN sign-in and for one over the public hostname (`proxy-addr` is what
      resolves it).
- [ ] **Beta-test the cached status and health polls (plan.md §873 item 3)** — on `beta`, open the
      Apps page in two tabs for a few minutes: the cards still flip to Running within ~15 s of a
      start and back on a stop, the header's CPU/disk/memory figures still move and agree between
      tabs, and a disk alert still appears when a threshold is crossed. Change an app's port in its
      config panel and confirm the Running panel shows the new port after a restart (that value is
      the one now cached per cycle).

### Critique round 2 (plan.md §812)

Surfaces never critiqued. Per item: `/impeccable critique` against a real render, log the
score in a new plan section, then fix one page at a time, test first, own commit and version
bump. Delete the item when its fixes land (a fix still needing a `beta` look gets its own item).

- [ ] **Users: fix the critique's findings (plan.md §813)** — in order, test first, one
      commit and version bump each: (1) done (§814) — on `beta`, open Users on a phone and a
      laptop with a very long email and the reset-password editor open: no sideways scroll,
      Reset password and Delete reachable; (2) done (§815) — on `beta`, open any
      confirm (delete a user): focus is in the dialog, Tab stays in it, Esc returns focus to the
      button, Enter with focus on the page does nothing; (3) done (§816) — on `beta`, delete a user
      with app access (the dialog lists the apps), untick an app in Edit access (the line under the
      grid names it), open Reset password (the 8-character rule is visible, Save is held); (4) done (§817) — on `beta`, open Users: the
      accounts are listed without a click, each person is one line, **Edit roles** opens the
      checkboxes and Cancel drops unsaved ones, and your own row has no Edit roles; (5) done (§826) — on `beta`, open Edit roles: the roles read Full admin, Admin and App user
      with a line each, no "SSO user" or "Webmaster"; under Features, Everything, Day to day and View only
      tick the boxes, the chosen one shows pressed, editing a box shows Custom, and nothing changes until
      Save; the same in the Add user form and in pt-PT, with no sideways scroll on a phone. The P2 focus-ring and control-border contrast belongs to the shared theme and
      is its own item below. On `beta`, after each: open Users on a phone with a long email.
- [ ] **Beta-test the shared theme's focus ring and control edges (plan.md §818)** — on `beta`,
      Tab through Users, Settings and Backups in dark and light: every control shows a solid blue
      ring (no mouse-click ring on buttons), and inputs, selects and unticked boxes have a visible
      edge. Open a Tally shop view and check the same there.
- [ ] **Beta-test touch targets on a phone (plan.md §824)** — on `beta`, at 390px wide (browser
      device mode): Users, Backups, Settings and a Tally shop view. Every button is 44px tall with its
      label centred, tapping anywhere on a checkbox's row toggles it, no page scrolls sideways and
      no row of buttons overflows. At 1280px nothing looks different from before.
- [ ] **Utils: fix the critique's findings (plan.md §841)** — 20/40. In order, test first, one
      commit and version bump each. Decided 2026-10-06: **fold** `/utils` away — health moves onto
      Home, the scan into a Settings panel, then the route, nav item and tile go and `/utils`
      redirects to `/home`. Order: (1) done (§842) — on `beta`, Home shows "Server health": a sentence
      ("Everything is running normally." or one per problem), a row each for business data, disk,
      memory and server load with Fine / Needs attention beside each bar, and "Checked HH:MM"; the
      disk and memory figures match the header strip's units; in pt-PT no English; on a phone the rows
      stack with no sideways scroll; block the API (stop the backend) before first load and Try
      again appears; (2) done (§843) — on `beta`, Settings shows "Find devices on your network" (to `settings:manage`);
      press Find devices with the keyboard: focus stays on the button, "Scanning your network…" is read
      out, then "Found N devices." and the table with Name / Device maker / Address; an account with
      `apps:control` but not `settings:manage` no longer sees the panel and gets 403 from the API
      unplug the box's network and scan: the failure shows beside the button; (3) done (§844) — on `beta`,
      the nav and Home have no Utils, Home has seven tiles in even rows (two wide: Apps, Backups),
      the Settings tile's text mentions finding devices, and opening `/utils` by hand lands on Home;
      (4) done (§864) — on `beta`, press Find devices: the first row is this server with a "This server" badge,
      named devices follow, devices with no name or maker sit under "Not recognised".
      On `beta`, open Home and Settings on a phone and a laptop, EN and pt-PT.
- [ ] **Content: fix the critique's findings (plan.md §845, §847)** — 16/40, all six done. Decided 2026-10-06:
      Content is a **post generator**, and **subscribers are managed on the same page**. In order,
      test first, one commit and version bump each: (1) done (§846) — on `beta`, edit a draft and
      press Email to subscribers without Save: the dialog says your changes are saved first, and the email that
      arrives has the edited text; clear the box and press it: refused, nothing sent; (2) done (§848) — on `beta`, Content has a Subscribers panel: add an address with the keyboard
      ("Added …" is read out, the box keeps focus), it appears in the list; subscribe through the
      public form, then use the unsubscribe link in a sent email, and the row reads Unsubscribed with
      a date; typing that address in the box again is refused ("Only they can sign up again"); Remove
      asks first and names the address; on a phone the rows stack with no sideways scroll; an
      account without `settings:manage` cannot reach it (403);
      (3) done (§849, §850) — on `beta`, a draft shows Copy, Save, Email to subscribers, Delete;
      Copy puts the text on the clipboard (try it over plain http on the LAN too) and says so;
      Email to subscribers opens a dialog naming how many people, the subject and the text, and with
      no subscribers it refuses with a pointer to the Subscribers panel; after a real send (needs the
      shared mailbox set) the draft reads "Sent <date> to N subscribers", and sending it again warns
      "You already sent this post"; (4) done (§851) — on `beta`, a send where some addresses bounce (e.g. add one at a dead domain
      next to a good one) is a yellow warning "Sent to 1 of 2 subscribers. 1 did not get it.", and the
      draft keeps the line "1 of 2 subscribers did not get it. Sending again emails everyone…" in
      readable colour on both themes; (5) done (§852) — on `beta`, with no AI key set, Generate (Enter on the button) says "No AI key is set
      up yet… Add one in Settings." beside the button with a working link, the brief is kept, no toast;
      with a key, the wait line reads "Writing your draft…", the Drafts panel opens and the cursor is in
      the new draft; Save leaves the cursor in that draft, Delete announces "Draft deleted." and
      leaves it in the brief box; stop the backend and reload: the drafts area offers Try again; in
      pt-PT no English error text appears anywhere on the page; (6) done (§853) — on `beta`, a first visit lands on the open "Generate a draft" box asking "What
      should the post say?", with Drafts open too once there are drafts, and no "Brief" or "Claude"
      anywhere, in pt-PT too. All six are done (plus two minor findings, §908: trailing-whitespace dirty check, brief counter — on `beta`, paste 3600+ characters into the brief box: a "N / 4000 characters" line appears, typing stops at 4000); this item is now only the `beta` looks. On `beta`, after each: open Content on a phone and
      a laptop, EN and pt-PT.
- [ ] **Beta-test the small pages' fixes (plan.md §855-§862)** — all seven §854 findings are in; on
      `beta`, EN and pt-PT, phone and laptop: (1-2) open an unsubscribe link from a real advert
      email: one button, nothing happens until the tap, reload does not unsubscribe, a second tap is
      harmless; the email ends "You are receiving this because you subscribed to <dashboard host>."
      above the link, its headers include `List-Unsubscribe` and `List-Unsubscribe-Post`, the mail
      app's own unsubscribe button works in one tap (that also proves `/api/subscribers/*` is
      reachable at the public URL), "Subscribe again" brings you back, no "Go to sign in";
      (5) with the backend stopped the page says it could not reach the server and the button reads
      Try again (the 429 text needs 20 taps in 15 min); (3-4, 7) Audit logs: Result is the first column,
      actions read as sentences (hover shows the code), a long probe resource wraps, Export CSV keeps
      raw codes; stopping the backend gives an alert with Retry, a filter with no match gives Clear
      filters, Enter in a filter searches, paging reads "21-40 of 200", the retention/time-zone line
      shows, a "from" time filters in your own zone; (6) open a denied app signed in without access:
      "signed in as", Request access pressable when empty and names what is missing, focus on the
      confirmation after sending, "Sign in with a different account" signs out (Authelia's own
      session stays).
- [ ] **Account: fix the critique's findings (plan.md §819)** — all five done; this item is now
      only the `beta` look. (1) §820 — on `beta`, Turn it off asks for a code or recovery code (no
      password field), then a confirm; a wrong code is refused and 2FA stays on; (2) §821 — a wrong
      enrol code and a wrong disable code each show a message under their own field (in pt-PT too)
      and put the cursor back in it; (3) §822 — after Activate: "Save these now" first, no green
      alert or toast, Done greyed until Copy, Download or the tick box; (4) §823 — the panel opens
      by default, no "TOTP"/"enrolment"; (5) §825 — **on a phone**: the setup step has an "Open in
      your authenticator app" link and a Copy key button, focus lands on the step's heading, then on
      the status line after Cancel, Done and turning it off, and a line says leaving starts over.
      Run the full journey (set up, wrong code, activate, recovery codes, disable) on a phone.
- [ ] **Sign-in flow: fix the critique's findings (plan.md §827)** — all five done; this item is now
      only the `beta` look. On a phone, in EN and pt-PT, on login, setup, a used invite link and
      `/recovery`: (1) §829 — login has a closed "Locked out?" line naming the Users page and
      `./start.sh recover reset-password`, the code step has "Lost your authenticator?" naming
      `disable-2fa`, `/recovery` shows the commands in a blue notice with its buttons off; (2) §828 —
      a wrong password and a wrong code read in your language, are announced, and the cursor returns
      to the field with its text selected; (3) §830 — a used link says to ask whoever invited you and
      has a full-width Back to sign in, a refused password shows inside the card, setup's mismatch is
      under the confirm field; (4) §831 — each password field has a Show button, "At least 8
      characters." is under new passwords, the cursor starts in the first field, `/recovery` inputs
      are 44px; (5) §832 — the card is centred (equal space either side at every width) and all four
      pages look like the same card, `/recovery` included.
- [ ] **Updates page: fix the critique's findings (plan.md §834)** — all five done; this item is now
      only the `beta` look, on a phone and a laptop, EN and pt-PT. (5) §839 — the page opens with the
      panel open and leads with one badge: "Up to date" / "N updates available" / "Updating…" /
      "Last update failed" (red) / "Updated, N apps need attention"; badges are 13px; the confirm's
      Update button is blue, not red. The other four: (1) §835 — with the box offline press Update now:
      the red headline says nothing changed, the git error is behind a closed "Technical details";
      reconnect and press again: it updates (a real failed build cannot be provoked from the page; the
      retry that rebuilds is unit-tested only); (2) §836 — the confirm says changed apps update too and
      no backup is made first, naming the Backups page; (3) §837 — in pt-PT a failed Check now shows
      a Portuguese toast and the check-failed line keeps the git message behind "Detalhes técnicos",
      and the progress line says "os ecrãs do painel" / "o motor do painel"; (4) §838 — during a real
      update the line reads "Step 2 of 5. Getting the update ready…" with "You can leave this page
      open…", Tab lands on it after you confirm, and when the run ends focus lands on the result.
- [ ] **Beta-test that Update now retries failed apps (plan.md §863)** — on `beta`, break one app's
      pull (e.g. point its image at a missing tag in a throwaway state, or stop the registry reach),
      press Update now after a pull that touches that app: the run lands with a warning naming it; fix
      the cause and press Update now again: the box says nothing is behind but runs, only that app
      updates, the warning goes away, and a third press says "Already up to date". Also after a build
      failure (§835) pressing Update now rebuilds instead of saying up to date.
- [ ] **Tally: the hero figure and the comparison (plan.md §806, items 1-2)** —
      on `beta`, open a shop's day view on a phone: today's takings must be the
      largest thing on the page, readable at arm's length, with "€X more/less
      than last <weekday>" under it. Check a day where last week's same weekday
      has no data, and a closed (archive) day, and confirm the sentence degrades
      rather than lying. Confirm the six Wintouch counters are collapsed by
      default and that opening them is one tap.
- [ ] **Tally: keyboard and screen-reader pass (plan.md §806, item 3)** — on
      `beta`, Tab to a table row in the Tables tab and open it with Enter/Space;
      it must expand, announce its state, and return focus sensibly. Confirm the
      Shops page shows "Request failed" alone when the API is unreachable (stop
      the tally container) rather than also claiming there are no shops.
- [ ] **Tally agent: the closed day the live table swallows (plan.md §810)** — in
      `apps/tally/app/agent/ShopReader.cs`, `ResolveDayAsync` falls back to
      `DateTime.Today` when `wsir_vnd_vendas` is empty, and `ReadOverviewAsync`
      then takes the *live* path for that date, so if Wintouch empties the live
      table at day close the day's archive is unreachable and the hero reads
      "Nothing rung up yet" at the moment tonight's total is wanted. **First
      confirm the premise on a real shop** (read the overview just before and just
      after a day close; is the table empty?). If so: when the live table is empty
      and the archive has F documents for that day, return the archive overview
      with `archive: true`, and add a "closed before midnight" fixture. Needs
      `dotnet`, which the dev host does not have; the agent installer ships it to
      every shop, so it is not an edit to make blind.
- [ ] **Tally agent: do live and archived days agree? (plan.md §810)** — read one
      real day through both paths and compare: average ticket (net numerator over
      a sales-only denominator), discounts / customers / consumptions (defined
      differently live and archived), the hour buckets (line `EntryDate` live vs
      header `entrydate` archived, which can put a "by 14:00" comparison's two
      sides in different hours), and whether stale `wsir_vnd_pedidos` rows inflate
      Forecast. Any disagreement is a defect in what the owner is told.
- [ ] **Tally: the fourth critique's web fixes (plan.md §810)** — on `beta`, on a
      phone: switch away from the app for a few minutes and back — the figures must
      refresh on return, not on the next 30 s tick; tap a column of the hourly
      chart and read its figure; on a closed day the hero names the date; a shop
      with no tables opens on Items with no empty Tables tab; the items table
      shows ten rows with "Show all"; with the till PC switched off, the panel
      says to check it and recovers on its own — also while viewing a past day.
- [ ] **Tally: the third critique's fixes (plan.md §806.8)** — on `beta`: shortly
      after midnight (or any time the shop's trading day is not today's date)
      the hero must say "Taken on dd/MM", not "today"; mid-afternoon the
      comparison must read "…by HH:00" with the hour a complete one; unplug the
      till PC's network and confirm "Last seen" shows the real time (and the
      date if it was yesterday), not the time the page opened; in Portuguese,
      the sentence reads "… {dia} da semana passada" for a Monday as well as a
      Saturday; a typed day outside the picker's range is refused; and with an
      open-tabs figure above €10,000 on a 360px phone nothing spills out of its
      tile.
- [ ] **Tally: sole-shop viewers skip the list (plan.md §809)** — on `beta`, sign in
      as a non-admin who has been granted exactly one shop: opening Tally must land
      on that shop directly (no flash of the list), the shop page must have no
      "← All shops" link, and the browser back button must not bounce between the
      two. Then as an admin with one shop, and as a non-admin with two, confirm
      the list and the link are both still there.
- [ ] **Tally: clarity wording and the quiet-day view (plan.md §806.7)** — on
      `beta`, mid-morning on a running day the sentence under the hero must end
      "by this hour" ("a esta hora"); on a closed day it must not. Before the
      first sale only the one-sentence card, Tables in use and Here now show —
      no hourly card, no empty staff/payment charts — and the Tables/Items bar
      is still there. "Forecast" reads "Taken plus open tabs" and Open tabs reads
      "Not paid yet". A closed day with no sales says "No takings that day", not
      "yet"/"today".
- [ ] **Beta-test the shared theme's semantic colours (plan.md §807)** — on `beta`,
      look at the dashboard in both light and dark: the Start/Stop/Settings
      buttons on Apps, the red failure text on Backups and Settings, the green
      "OK" states, and any outline button must all be clearly readable — the
      light-mode warning (yellow) text especially, which was 1.5:1 before. Hover an
      outline button and confirm its label stays readable on the filled hover.
      The hotel apps (admin, check-in, pulse) share this theme; open one in
      each mode and confirm nothing reads washed out or too dark.
- [ ] **Tally: touch targets, titles and the tables-in-use count (plan.md §806.6)** —
      on `beta`, on a phone: the day-counters heading, a table's number and the
      back link must each be easy to hit (44px); the tab title reads "<shop> ·
      Tally"; and with some tables awaiting payment, "Tables in use" must count
      them (e.g. 6 seated + 4 waiting shows 10, with "4 waiting to pay").
- [ ] **Tally: URL state, refresh feedback and offline (plan.md §806.5)** — on
      `beta`, pick a past day on a phone, reload: you must land on that day, and
      the address must carry `?date=`. Press Refresh: it must read "Refreshing…"
      and be disabled until it lands. Switch Tables ↔ Items and confirm no
      overview request goes to the shop (browser Network tab). Turn the phone
      offline: "You are offline" must appear, and clear on reconnect. With a
      screen reader, Refresh announces "Updated at HH:MM" and the 30 s refresh
      stays silent; each chart reads as one graphic, not one line per bar.
- [ ] **Tally: contrast and touch targets (plan.md §806, item 4)** — on `beta`,
      in both light and dark, confirm every stat-card label is readable on a
      phone in daylight, and that Refresh, the theme toggle, the language select
      and the date input are all at least 44px tall on a touch device.
- [ ] **Beta-test the lost-publish detection (plan.md §805)** — on `beta`,
      simulate what happened to Authelia: `docker network disconnect
      authelia_default authelia-authelia-1` on the host, then watch the Apps
      page. Authelia's card must flip to **error** within one 15 s tick, with
      a message naming port 10100 — not stay green because its internal
      healthcheck still passes. Reconnect (`docker network connect`) or stop
      and start the app from the dashboard and confirm the card goes back to
      running. Also confirm no other app flips to error while this runs: a
      host-networked app (Home Assistant) and an app with no published port
      must both be unaffected.
- [ ] **Beta-test the OnPush service card (plan.md §808)** — on `beta`, on the
      Apps page with a real, busy box: start an app and watch its startup popup
      stream lines, flip to "running" and auto-close; open Settings and confirm
      the config and snapshot list fill in; run "Back up now" and see it go busy
      and idle; stop an app and confirm its row, health badge and dependency
      chips update within one 15 s tick *without* a manual refresh; switch the
      language and confirm every card re-renders. Any card that shows stale
      state after one of those is a missed `markForCheck()` (plan.md §808).
- [ ] **Beta-test that a config save leaves allocated ports alone (plan.md §800)** —
      the Settings panel no longer shows or submits `*_PORT` fields. On `beta`,
      open an app that has both a port and a real setting (Vaultwarden, ntfy),
      change the real setting, save, then confirm on the host that the app's
      `apps/<name>/.env` still has its original port line, and that the app
      restarts and is reachable on that same port. Check nginx-proxy-manager's
      panel reads "No settings for this app" rather than showing an empty form.
- [ ] **Beta-test the single settings writer (plan.md §799)** — *2026-10-07, over the API on
      the box: general (timezone, update branch), backup schedule, backup target, mail (+ its
      Test), alerts and exposure (blank password; Test passes for NPM and Cloudflare) all come back
      byte-identical after a save. Still to do: Cloudflare token, AI API keys, health thresholds,
      the restore-a-backup step, and the same forms through the UI.* Every save
      into the `settings` table now goes through one batched upsert, so a
      mistake would hit every settings form at once. On `beta`, save and
      re-open each of: Settings → exposure (base domain / NPM email, leaving
      the password blank — confirm the stored password still works, i.e. the
      "Test" button still passes), Settings → mail (then "Test"), Backups →
      destination, Backups → schedule, Settings → Cloudflare token, the AI API
      keys panel, the health thresholds, the timezone and the update branch.
      Each should come back with exactly what was typed and nothing else
      reset. Then restore a backup and confirm the settings it carried came
      back (Backups → restore, then re-check the exposure panel).
- [ ] **Beta-test the rebuilt status poll (plan.md §798)** — *2026-10-07, API vs `docker ps`:
      states match for all 44 apps; Pi-hole lists 53/tcp and 53/udp, netbird-vpn its four ports,
      Home Assistant 8123. Still to do: public and secondary URLs on the card, two tabs open at
      once, the pin badge clearing.* The whole status
      payload now comes from one `docker ps -a` and one `service_exposure`
      read, so a mistake here shows up as *every* app reading wrong at once.
      On `beta`: open Apps and confirm each app's state matches
      `docker ps` on the host (running/stopped/error), that a running
      multi-container app still lists **all** its published host ports (check
      Pi-hole, which publishes 53/tcp *and* 53/udp on the same host port, and
      netbird-vpn), that a stopped app lists none, and that the public URL and
      any secondary URLs (netbird-vpn's Management API) still appear on the
      card. Start and stop an app and confirm the card follows within one
      15 s tick. Then open the dashboard in **two** tabs at once and confirm
      both update — they now share one build rather than each running their
      own. Finally check an app with a pinned image still shows its pin badge
      after the pin is cleared from the Updates page (the compose YAML is now
      memoised on mtime, so a stale badge would be the bug).
- [ ] **Beta-test the WebSocket/SSE fix for live service status (plan.md §792)** —
      on `beta`, open Apps and expand "All apps": confirm it shows real rows (not
      a permanent "Loading services…") and a **Connected** badge, not **sse** or
      **polling**, within a second or two of opening the page. Open the browser's
      Network tab and confirm `wss://<host>/ws/services` shows `101 Switching
      Protocols`, not a plain 200. Check Home's status headline updates live too
      (stop an app from another tab/device and watch it flip without a manual
      refresh). This was never actually working through nginx before — confirm
      it now does on the real tunnel/NPM path, not just the direct container
      path the test stack exercises.
- [ ] **Beta-test Home's new badges (plan.md §788)** — *2026-10-07: the data behind both is right
      (`/backups/last-successful` is dated today; `/self-update/check` reports `commitsBehind: 1`
      when `beta` is ahead). Still to do: how the two tiles render, and the failed-read case.* On `beta`, with a
      successful app-data backup on record, confirm the Backups tile shows
      its age ("Backed up Nd ago" / "Backed up today"), and that the Updates
      tile shows "Update available" only once `beta` is genuinely behind
      `origin/beta` (it won't be, right after a pull — check right before the
      next commit lands, or watch it clear after updating). Confirm neither
      badge triggers an error toast if you can make one of the two reads fail
      (e.g. stop the backend's DB briefly) — the tile should just show no
      badge, not an error.
- [ ] **Beta-test the derived Cloudflare account/zone IDs (plan.md §785)** — on
      `beta`, open Settings → Networking with the account/zone fields blank
      under **Advanced**, save, and confirm the exposure config ends up with
      the right IDs (check the saved settings, or that exposure still works)
      without typing either one. Then type an override under Advanced, save,
      and confirm that value wins instead of a fresh lookup. Also try saving
      with no Cloudflare token stored yet and confirm the error is the plain
      "save the token first" message, not a raw exception.

### Audit findings, the other 12 pages (plan.md §790, §791)

`/impeccable audit` extended past the original four (login, setup, recovery,
set-password, access-denied, unsubscribe, content, utils, audit-logs, users, updates,
account). A raw Joi validation leak on set-password/unsubscribe, the theme toggle's
icon, and Utils/Updates' top-level jargon were all fixed live in that pass (§790,
§791). One deferred, deliberately not folded into that fix:

### Apps page (impeccable critique, plan.md §761)

- [ ] **Beta-test "Show details" after a real failed start (plan.md §774)** — on `beta`,
      hold an app's port with a listener (e.g. IT Tools, 10490), press Start: the row must
      show "Couldn't start X. Try again" *and* a "Show details" with the compose failure
      text. Free the port, Try again → running; stop it and break it another way → no stale
      text. Still unseen: the "Starting…" Start button (the box goes stopped → running with
      no visible `starting` state). Delete once seen.

- [ ] **Beta-test the "Local network" row link (plan.md §772, §773)** — the Running panel is
      gone, the Running tile filters, public links and Settings ports passed. Still unseen:
      the fallback link, which needs a running app with no public hostname (every app on the
      box is exposed or LAN/VPN-only). Delete once seen.

- [ ] **Beta-test the Apps page scale tools, remainder (plan.md §767, §773)** — headline
      "All N apps are fine." and the tile filters passed in en and pt-PT. Still unseen: the
      "N of M apps need you." wording and a category with a failed app being open on load —
      needs an app left in `error` while the page loads. Delete once seen.

### Exposure and platform

- [ ] **Beta-test media apps reading the Samba share (plan.md §870)** — on `beta`, start
      Jellyfin, Navidrome and Immich. Over SMB, drop a video in `media/`, a song in `music/`,
      a photo in `photos/` of the share. Add the Jellyfin library `/media` and rescan: the
      video shows. Navidrome shows the song after its scan. Immich → Administration →
      External Libraries lists "Shared photos" and the photo appears. Check the three
      folders exist and an SMB user can write them (no "access denied").
- [ ] **Beta-test Paperless and Stirling-PDF on the Samba share (plan.md §907)** — on `beta`, after
      the update recreates both. **Paperless:** consume one scan; within seconds
      `<id>-<name>.pdf` appears in `paperless-archive/` over SMB, and the Paperless container log
      shows no "post-consume" error; existing documents are not copied (by design). **Stirling:**
      the share has `to-stirling-compress/compress.json` and `from-stirling/`; drop a PDF into
      the first, wait ~1-2 min, a compressed `<name>-compress.pdf` lands in `from-stirling/`.
      If nothing happens, the pipeline JSON key names are the suspect (written from memory,
      no live Stirling to check) or folder scanning needs `system.enableAlphaFunctionality: true`
      in `data/configs/settings.yml`; check `docker logs` for "pipeline".
- [ ] **Beta-test DocuSeal signed-PDF copy (plan.md §872)** — on `beta`, start DocuSeal,
      sign one submission to the end, then wait for the next start or the hourly sweep.
      A PDF named `<submission>-<submitter>-<file>.pdf` appears in `signed/` of the share
      over SMB; a second run copies nothing new (backend log "Copied N signed DocuSeal
      document(s)"). If the log says "signed-document copy failed", the rails script's
      model calls (`Submitter#documents`) need correcting; they were written without a
      live DocuSeal to check.
- [ ] **One-off: move the live ITFlow data onto the dev box (plan.md §865)** — planned,
      not run. **Blocked: owner must decide how the 3 live users merge with the 2 dev users
      before the import (step 5).** Then run §865 steps 1–8 and delete this item once the
      counts (54 clients, 322 tickets, 3 users), an attachment and a vault password check out.

- [ ] **Beta-test that a bumped image-check date moves exactly one app (plan.md §750, §751)**
      — the code-only half is **confirmed** (§751: run 113, 1m47s, zero
      `SERVICE_UPDATE` audit rows). What is left is the positive case: bump one
      app's image-check date comment on `dev` (a `:latest` app with a real newer
      image, as §744 did for `wetty`), merge to `beta`, press Update, and confirm
      only that app is pulled and recreated (`docker inspect` `Created` moves for
      it and for no other app) and the run takes minutes, not a sweep. Best done
      the next time a real "check if X can update" comes up.

- [ ] **Beta-test Navidrome's Authelia sign-in (plan.md §749)** — checks (2)
      and (3) are **confirmed** (2026-09-29, at 0.153.8): the LAN
      `Remote-User` request to `:10570/api/album` is 401, and a forged header
      on the public `getAlbumList2.view` still gets "Wrong username or
      password". What is left needs a browser: (1) an Authelia login lands
      **straight in the library** with no Navidrome login screen, as the
      Authelia admin; and a non-admin Authelia user is auto-created in
      Navidrome as a non-admin.

- [ ] **Beta-test Nextcloud's 34→35 major upgrade (plan.md §711)** — the
      upgrade itself is **confirmed** (2026-09-28, over SSH at 0.151.5): the
      image pulled, the container is healthy, and `/status.php` reports
      `"version":"35.0.1.1"` with `maintenance:false` and
      `needsDbUpgrade:false` — so it did not stick in maintenance mode, which
      was this item's real risk. Also confirmed as far as `occ` proves it:
      `files_external:verify` on the `/Shared` mount returns `status: ok` and
      `/shared` lists inside the container; `onlyoffice 10.2.1` and
      `user_saml 8.4.0` are both **Enabled** and the OnlyOffice container is
      healthy. What is left needs a browser — that state being right does not
      prove the UI works: browse a folder under `/Shared` in the Nextcloud
      web UI, open a document and confirm the OnlyOffice editor actually
      launches, and complete one SAML login.

- [ ] **Beta-test light/dark mode (plan.md §696)** — on `beta`, after pulling
      (dashboard and Tally rebuild), open the dashboard and `tally.<domain>`
      with the OS set to light: both should load light with no dark flash, and
      with the OS set to dark, dark. The ☀/☾ button in the header/navbar should
      flip the page and the choice should survive a reload. Walk Home, Apps
      (open a service card and its logs), Backups, Settings and Tally's shop
      page in light: look for unreadable text, dark-on-dark panels and shadows
      that look muddy. The strict-CSP e2e (`csp.spec.ts`) covers the external
      `theme-init.js` loading.
      Also check the Hotel admin, check-in and feedback (pulse) pages the same
      way (plan.md §697) — a guest link on a phone is the one that matters.
- [ ] **Beta-test Tally's language switch (plan.md §688)** — on `beta`, after
      pulling (Tally rebuilds), open `tally.<domain>`: the navbar select should
      switch English ⇄ Português, the choice should survive a reload, and in
      Português the Shops list, a shop page (stat cards, chart, Tables and Items
      sold tabs, dates as dd/MM, money as `4 582,18 €`) and the Manage panel
      (access list, Issue enrolment code) should have no English left except
      shop/staff/item names from Wintouch.
- [ ] **Beta-test Paperless user provisioning (plan.md §692, §693)** — the
      database half is **confirmed** (2026-09-28, over SSH at 0.151.5, and
      the same half §706 reached): `mat` — the Authelia admin, checked
      against `users_database.yml` — is `is_superuser=True, is_staff=True`,
      and the two non-admin Authelia users (`frias`, `miguel`) are both in
      the `Authelia users` group, which carries 56 permissions. (`admin` is
      Paperless's own seeded superuser, expected.) That is the provisioning
      working; it is **not** the item, because the bug §692 fixed was a UI
      symptom. What is left needs a browser: open `paperless.<domain>` as the
      Authelia admin and confirm the dashboard loads with no "You do not have
      permission" toast; sign in as a non-admin and confirm the app loads,
      that it can upload and tag a document, and that it sees none of the
      admin's owned documents. For a fresh-clone check, stop Paperless,
      delete the Authelia admin's row from its `auth_user` (or wipe
      `apps/paperless/data`) and start again — the login must come back as a
      superuser.
- [ ] **Beta-test the restart-noise fix (plan.md §668)** — on `beta`, trigger
      an update from the Update page and watch through "Restarting the
      backend": no red "Something went wrong" / "Unable to reach the backend"
      toasts should appear (from the status poll or the resource strip), and
      the panel should end on the "up to date" success toast.
- [ ] **Beta-test the new Outline app (plan.md §666)** — on `beta`, after
      pulling, start Outline from the Apps page (it needs Authelia running
      and the app exposed — Outline has no local login). Confirm: the
      `outline-init` chown runs and `outline` reaches healthy (first boot
      runs all DB migrations, ~2 min); a browser sign-in at
      `outline.<domain>` completes through Authelia with no
      `invalid_client` at `/auth/oidc.callback` (if it does, switch
      `tokenEndpointAuthMethod` to `client_secret_basic`, as §665); the first
      user lands as workspace admin; uploading an image to a doc persists
      (proves the storage chown); and **a second Authelia user can sign in**
      — if Outline demands an invite, open a follow-up to invite users
      automatically (principle 3).
- [ ] **Beta-test the self-update panel's richer progress detail (plan.md
      §659)** — on `beta`, trigger a real self-update while a commit is
      pending and confirm: the progress alert shows a `detail` suffix naming
      which image is building (`frontend`/`backend`) one at a time rather
      than a single flat "Building…" line; while apps are updating, the
      detail shows `<app> (n/total)` and advances as each app is pulled and
      recreated; and if `origin` is briefly unreachable when a run starts,
      the run shows `checking` for the duration of that fetch and lands as
      an `error` row (visible in run history) rather than the trigger
      request hanging with no row at all.
- [ ] **NetBird Android client blocks all non-NetBird traffic once connected**
      — matches upstream
      [netbirdio/android-client#96](https://github.com/netbirdio/android-client/issues/96),
      open/unfixed. Our server-side routes are correctly scoped (two `/24` LAN
      resources, no exit node), so this is the mobile app itself, not this
      repo's config. Check that issue periodically; delete this item once it's
      closed upstream (or once an app update fixes it for us, whichever comes
      first). Last checked 2026-09-29: still open (no upstream activity since
      2025-11-05).
- [ ] **Re-enable the CrowdSec Cloudflare Worker bouncer once its token bug is
      fixed** — the edge-level bouncer (`cloudflare-worker-bouncer` in
      `apps/crowdsec/docker-compose.yml`, behind the `edge-bouncer` compose
      profile) would drop flagged IPs at the Cloudflare edge, further
      upstream than the NPM Lua bouncer currently enforcing bans (plan.md
      §567's #3, §23.17) — but as of v0.0.18 it crash-loops
      ("Authentication error (10000)") against Cloudflare API tokens with the
      newer `cfut_` prefix, even with full Workers/KV/Routes scope (verified
      via curl). Its config is already rendered on every start
      (`services/crowdsecConfig.ts`), so re-enabling it is just
      `docker compose --profile edge-bouncer up -d` once a classic token
      works or upstream fixes the auth path. Check periodically; delete this
      item once it's fixed and the bouncer is confirmed enforcing live. Last
      checked 2026-09-29: latest release is still v0.0.18 (2026-06-02), and no
      upstream issue names the 10000 auth error.
- [ ] **MeshCentral: prove real agent enrolment through the public tunnel**
      — the app is up, reachable at its own hostname with no Authelia gate,
      and its own login page confirmed live (§505/§506), but the actual
      point of re-adding it is agents on machines that aren't ours, dialing
      in over Cloudflare + NPM rather than the overlay. Needs a real second
      device (VM or spare machine) to install the agent on and confirm: the
      cert path holds (`REVERSE_PROXY`/`certUrl` — MeshCentral's documented
      fix for "Agent bad web cert hash" behind a proxy that isn't
      MeshCentral's own TLS) and a KVM/terminal session actually relays over
      WebSocket without WebRTC. Nothing here can be proven from the
      dashboard host alone.


- [ ] **Beta-test the Hotel apps' no-cache index.html (plan.md §701)** — the
      `curl` half is **confirmed** (2026-09-29, at 0.153.8): admin, check-in
      and pulse each return `Cache-Control: no-cache` on `/` and on a deep
      link. What is left is a phone: push a visible change and confirm a phone
      that already opened the guest link shows it on the next open.

- [ ] **Beta-test the Hotel healthcheck fix (plan.md §708)** — the container
      half is **confirmed** (2026-09-28, over SSH at 0.151.5): `docker ps`
      shows `admin`, `check-in` and `pulse` all `healthy`, last probe exit
      code 0, and the HTTP probe the dashboard uses — hotel-core's
      `/api/health` — answers `200 {"status":"ok"}`. What is left is looking
      at the dashboard itself: Hotel is **one** card in the registry (there
      is a single `hotel` entry in `services.ts`, health-checked by that one
      probe — not three cards, as this item used to say), so confirm that
      card reads healthy on the Apps page rather than showing an error.

- [ ] **Beta-test the ntfy panel regrouping (§609/§615)** — one grouped row
      per category (switch + topic + Test) replaced the old shared-default-topic
      + single CrowdSec switch + separate Enforcement switch. On `beta`: open
      Settings → ntfy alerts and confirm all four rows show a real topic (the
      one-time migration should have backfilled any category that was
      relying on the old shared default, not silently reset it to
      `homelab-alerts`); toggle a switch and confirm Test greys out when off;
      confirm CrowdSec bans are still enforced at Nginx Proxy Manager (a
      banned IP still gets a 403) even though its switch is gone from
      Settings.

- [ ] **Beta-test the social-drafts publish path (plan.md §660)** — on
      `beta`: configure the shared mailbox and Dashboard URL in Settings,
      subscribe a real address via `POST /api/subscribers`, generate a
      draft on the Content page, click Publish, and confirm a real email
      arrives with the draft's content and a working
      `{baseUrl}/unsubscribe/{token}` link; confirm Publish is blocked with
      a clear error when the mailbox or Dashboard URL isn't set yet, and
      that an unsubscribed address stops receiving further publishes.
      Slice 2 (social-platform posting) still needs a per-platform
      token/OAuth setup and is scoped only once a specific platform is
      named.

- [ ] **Beta-test the multi-provider AI API Keys panel (plan.md §662)** —
      built: Settings → AI API Keys now has one grouped key+Test row each
      for Anthropic, Google Gemini and Groq, plus which provider powers
      social-post generation and Mealie AI recipe parsing. Nothing off a
      dev checkout can prove a real key against each provider's live API,
      or that Mealie's own AI-provider row actually gets re-pointed there.
      On `beta`: save a real key for at least one non-Anthropic provider
      (Gemini or Groq — both have real free tiers) and confirm Test
      succeeds; switch social-post generation to it and generate a real
      draft on the Content page; switch Mealie AI recipe parsing to it and
      confirm Mealie's own AI settings page shows the "AI Provider
      (dashboard-managed)" row pointed at that provider's endpoint; import
      a recipe by URL and confirm it still parses. Also confirm an
      existing Anthropic key from before this change (the old `claude_api_key`
      row) came through as the Anthropic row's already-configured key with
      no re-entry needed.

- [ ] **Beta-test the secondary-hostname rename teardown (plan.md §716)** —
      the same exercise §714 passed for a primary hostname (plan.md §724), but
      for an `additionalExposures` entry.

      **Use `exposureSubdomain`, not the `suffix`.** Changing a suffix renames
      the exposure *key* (`netbird-vpn:api` → `:mgmt`), which takes the
      pre-existing "secondary no longer declared" cleanup path — not §716's
      fix, which fires when the key stays put and only the hostname moves.
      `buildExposureHostname` stems secondaries from
      `exposureSubdomain ?? serviceName`, so adding
      `exposureSubdomain: 'nb'` to `netbird-vpn` moves all three hostnames
      (`netbird-vpn.<domain>` → `nb.<domain>`, `netbird-vpn-api` → `nb-api`,
      `netbird-vpn-relay` → `nb-relay`) while every key is unchanged. That is
      the §716 path, and it covers §714's primary path in the same pass.

      Add it, rebuild, wait for the sweep, then confirm: each old hostname
      stops resolving with its NPM proxy host gone (`docker exec
      nginx-proxy-manager grep -l server_name /data/nginx/proxy_host/*.conf`)
      and its Cloudflare DNS record gone; each new hostname answers; the
      `netbird-vpn:api` and `:relay` rows still **exist** (keys unchanged)
      carrying the new hostnames and fresh `npm_host_id`s. Then remove
      `exposureSubdomain`, rebuild, and confirm it swaps back leaving exactly
      one proxy host per hostname. The **no-op path is already confirmed** (2026-09-28, at
      0.151.13): across a full 34-service reconciler sweep all six secondary
      rows kept their exact `npm_host_id` and `cf_hostname_id`
      (`netbird-vpn:api` 3, `:relay` 4, `hotel:core` 43, `:checkin` 44,
      `:pulse` 45, `homepage:apex` 11) — nothing torn down and recreated. What
      is left is the rename half. Practicalities, learned on a 2026-09-28
      attempt that got as far as the edit before being interrupted:
      - It needs **two** backend rebuilds, one each way —
        `docker compose -f docker-compose.yml build backend` then
        `up -d --no-deps --force-recreate --no-build backend`. `/app/dist` is
        baked into the image, so editing `services.ts` alone changes nothing
        (`VERSION` is bind-mounted and misleads here).
      - A backend restart resets the reconciler's initial delay, so the sweep
        that applies the rename lands ~10 min later — no dashboard click needed.
      - The `api` entry carries `grpc: true`, so each rename also mints an NPM
        **certificate** for the new hostname via `ensureGrpcCertificate`. Those
        are self-signed, not Let's Encrypt, so there is no rate-limit risk — but
        check for and clean up a leftover `netbird-vpn-mgmt` cert object after
        reverting.
      - Leave the checkout clean afterwards (`git checkout --
        backend/src/config/services.ts`, then `git status --porcelain` empty) or
        the next self-update pull conflicts.

- [ ] **Beta-test that a failed start runs once (plan.md §717)** — on `beta`,
      make an app fail to start (easiest: stop a `dependsOn` dependency, or
      point an app's port at one already in use) and press Start. The card
      should show one failure toast, and `docker logs business-lab-backend`
      should carry exactly **one** `Starting service: <name>` line for that
      click, not two ~0.5s apart. A successful start must still refresh the
      card to `running` on its own.

- [ ] **Beta-test the backup schedule's timezone (plan.md §718)** — on
      `beta`, set Settings' timezone to something well off UTC (Europe/Lisbon
      is +1 in summer; America/New_York is a clearer -4/-5), set the Backups
      schedule to the hour that is ~1h away in *that* zone, and confirm the
      run fires then — `docker logs business-lab-backend | grep -i backup`,
      or the Backups page's "last run" stamp. Before this fix it fired at
      that hour **UTC**. Also confirm a schedule set to `00:00` still runs
      (the midnight/hour-24 path).

- [ ] **Beta-test the post-start reconciler refactor (plan.md §719)** — on
      `beta`, this touches every app's start path, so check a few apps whose
      post-`up` wiring is visible: start **Nextcloud** (its OnlyOffice/SAML
      `occ` wiring still applies — open a document, confirm the editor
      loads), **ITFlow** (its mail/cron settings still get written — the
      master cron switch is still on in its admin), and one ordinary app
      like **Paperless**. The backend half is **confirmed** (2026-09-28 at
      0.151.13): all three started, zero `Post-start reconciler … failed`
      lines, and — the check that actually matters, since a silently *skipped*
      reconciler would also produce zero failures — every reconciler logged
      `ok:true`. Nextcloud ran all six (OnlyOffice connector, ClamAV,
      `user_saml` incl. promoting `mat`, `/shared`, mail, maintenance window);
      ITFlow ran admin identity → password → **mail/cron (`hlm: cron enabled`)**
      → billing, i.e. in the order §719 flagged as load-bearing; Paperless
      logged `Authelia users provisioned`. What is left is the two browser
      confirmations: open a Nextcloud document and see the OnlyOffice editor
      load, and see the master cron switch on in ITFlow's own admin UI.

- [ ] **Beta-test the shared poll helper on a first boot (plan.md §720)** —
      nine first-admin bootstraps now wait through `pollUntilReady` instead of
      their own loop, and that code only really runs on an app's *first* start.
      On `beta`, stop an app with a bootstrap and remove its `data/` so it
      boots fresh — **Navidrome** or **Jellyfin** are the cheapest — then start
      it and confirm the admin account is created (log in as the Authelia admin)
      rather than the app showing its own claim-the-server wizard.
      `docker logs business-lab-backend` should show no "gave up: the app never
      became reachable" for it.

- [ ] **Beta-test the memoised OIDC client-secret digest (plan.md §731)** —
      the cache sits in the exposure sync path, which rewrites Authelia's
      managed `clients:` block and restarts Authelia when the block moves. A
      wrong digest would not fail loudly; it would reject every OIDC login.
      On `beta`, after pulling: toggle one OIDC app's exposure off and on
      (Vikunja, Mealie or Immich), confirm Authelia restarts at most once and
      that `apps/authelia/config/configuration.yml`'s managed block still
      carries a `$pbkdf2-sha512$` digest per client, then complete one real
      sign-in through that app's "Login with Authelia" button. Toggle a second
      app and confirm the first app's digest is byte-identical afterwards —
      that is the property the cache must preserve.

### Wintouch rebuilds — `check-in`, `pulse`, `tally`

Names are settled (plan.md §625): **`check-in`** (guest online check-in),
**`pulse`** (post-stay guest feedback, the old "quiz"), and **`tally`**
(invoices, employees and payments control, the old PBordo).

Target architecture is agreed and recorded in plan.md §623: Angular frontends,
Node/TypeScript/Express APIs, and .NET Windows services for the on-premise
agents only. The hotel side is `hotel-core` (owns units, guests and
reservations, and is the only service its agent talks to), `check-in`, `pulse`,
one `hotel-admin` Angular shell over all three, and a shared database
container. `tally` is an agent plus a single API + frontend. All of them land
as dashboard-managed apps under `apps/`.

**One box, one client is a requirement, not a side effect.** Every multi-client
construct in these projects is removed; plan.md §624 is the inventory. Hotel
Utils has no tenancy inside the app at all, so removal there is simply not
porting the deploy scripts. PBordo threads a `domain` layer through its store,
every API route, the SPA's landing page and the agent's config — removing that
is real design work. Multiplicity *within* a client stays: hotel `units` and
PBordo `stores` remain ordinary rows.

Remaining decisions were taken in plan.md §629: Authelia is the admin identity,
the agents read Wintouch over SQL but write through its own assemblies, only
feedback responses and check-in history migrate (everything else re-syncs), all
three half-built legacy features are in scope, each app owns its SMTP sender,
guest text stays per-client editable, and **`tally` is built first** — it is
smaller and proves agent enrolment and the tunnel WebSocket on a cheap surface.
App code follows `apps/price-compare/app/`: one source dir per service with its
own Dockerfile, tests and CI job.

The `sample/` copies stay reference-only. Per-slice scope is still proposed
before anything is built.

- [ ] **Prove the agent WebSocket survives the Cloudflare Tunnel** — the
      server side is built and works end to end through real containers
      (plan.md §634): an agent dials out to `/agent/connect`, authenticates
      with its enrolment token, and browser reads relay to it live. What is
      **not** proven is the one hop that cannot be tested here — a long-lived
      WebSocket through Cloudflare Tunnel → NPM → the container. Check on
      `beta`: the socket establishes through the public hostname (the Windows agent from §669 did), survives
      longer than the tunnel's idle timeout (the 30 s ping/pong should carry
      it), and reconnects by itself after the tunnel restarts. If it does not
      hold, §627 records the fallback — timer-pushed snapshots with a cached
      API — and that is a design change, not a patch.
- [ ] **First real build and a live run of the hotel agent, on the Windows
      machine with Wintouch installed** — `apps/hotel/agent/` (plan.md §653)
      is a close, call-by-call port of the legacy's own DAO classes, and it
      builds clean against the real Wintouch assemblies (checked from WSL by
      pointing the project's `HintPath`s at the mounted DLLs and building
      with `dotnet build`) — but nothing in that session could run it. There
      is no CI job for this project either (unlike `tally-agent`'s): the
      Wintouch DLLs it references are proprietary and per-install, so they
      can never be vendored into this public repo or fetched by CI. On the
      real machine: build it (`dotnet build -c Release`, into
      `C:\wintouch\sgw` so the assemblies are on the search path), issue an
      enrolment code from hotel-core, run `Hotel.Agent.exe enrol <CODE>`,
      install the service, and confirm a tick actually completes —
      `SetCurrentUser`/`SetDatabase`/`SwitchContext` succeed, units/guests/
      reservations land in hotel-core, and a real online check-in writes
      back into Wintouch (the `observacoes` stamp shows up on the
      reservation, and `AvisarObservacoes` flags it for reception). Also
      confirm check-out billing (plan.md §656) on the same machine: flip a
      unit's check-out billing switch on, let a reservation check out so the
      agent computes its bill, settle it in hotel-admin (to the guest on
      file, and separately to an overridden entity code), and confirm the
      agent's next tick actually moves the reservation's Wintouch account —
      `Contas.GetListContasAbertas` shows the charges under the chosen
      entity, not the guest's own account, when an override was used.
- [ ] **Verify a gated secondary hostname on the live stack** — built in
      plan.md §637: an `additionalExposures` entry can now set
      `autheliaProtected: true`, and the rule generator emits it with the
      app's own group and bypass paths. What tests cannot show is whether NPM
      actually renders forward-auth for a secondary host and Authelia accepts
      the enlarged block — and this repo's history has Authelia config that
      passed tests and took the gate down on the host (§423, §425). Check on
      `beta` once `apps/hotel/` exists: the gated secondary asks for a login,
      the public ones do not, the app's bypass path still answers
      unauthenticated, and Authelia restarts cleanly rather than crash-looping.
- [ ] **Confirm the installed Tally agent serves live Wintouch reads** —
      plan.md §669 proved install + enrolment, not the data. Open the shop's
      dashboard on `https://tally.tx-home-utils.com/`: it should show live
      tables, guests and open tabs (not an offline/error state), and one
      number (free tables or open tabs) should match Wintouch itself.
      Invoiced/staff/hourly are empty unless the date has sales (demo data
      is 2026-07-27, §636). If it misbehaves, stop the service and run
      `Wintouch.Tally.Agent.exe run` from an elevated console to see its log.
- [ ] **Prove the Tally agent restarts itself after a crash** — plan.md §669.
      Run the new setup exe (that also applies the recovery settings to the
      existing service), check `sc.exe qfailure Wintouch.Tally.Agent` lists restart
      actions, then from an elevated PowerShell kill it:
      `Stop-Process -Name Wintouch.Tally.Agent -Force`. Within ~5 s the service
      should be Running again under a new PID and reconnect in the dashboard.
      Also try it while the agent is unenrolled or the server is unreachable:
      it should stay Running and retry, not exit.
- [ ] **Beta-test that an update rebuilds apps built from source (plan.md §673, §674)**
      — on `beta`, after pulling this version, run the Update page and watch
      `tally`: its image should be rebuilt (`docker images tally-tally` shows a
      new timestamp; the update result names `tally-tally:latest`), not just
      recreated. The first build is slow (SDK image pull, `npm ci`, `ng build`,
      .NET publish) and runs under the classic builder — if it fails with a
      buildx/403 error, that is §290 again. Then the Tally page's **Download
      setup** card must appear for an admin. The shops page must no longer show "Email
      settings" (§676), and `tally-db` must have no `smtp_settings` table. Tally's and hotel's build contexts moved
      (`apps/tally/app`, `apps/hotel/api`) so the unreadable `data/db` is no
      longer inside them — if `hotel` is installed, its update must rebuild
      `hotel-core` too rather than fail with "can't stat".
- [ ] **Show the running day's figures from the new agent (plan.md §677)** —
      after installing the new setup exe, the shop page must say "Business day
      27/07/2026" (this box's demo day) and show invoiced €9,640.16 and the
      **Items sold** tab with 107 items / 434 units, each with its article code
      and family (top: Cerveja Barona Lagger P0316 ×33), and no "Pode Sair Mesa" — not
      empty (§678).
- [ ] **Look at older days from the new agent (plan.md §682)** — after installing
      the new setup exe, the shop page has a **Day** picker. Pick 03/06/2026: the
      header must read "Closed day 03/06/2026", invoiced €9,494.45, staff led by
      Philipe Santos, payments Cartao €7,950.53 / Dinheiro €1,154.92 / On Line
      €500.00 (sales only — no refunds), the items table topped by Couvert, and no
      open-tabs/tables/guests cards or Tables tab. **Running day** must return to
      27/07/2026 with €9,640.16 and the live panels. Also try a day with a group
      menu priced on its header (14/05/2026: "Menu Grupo 50" ×16 = €960.00).
- [ ] **Check refunds on a running day (plan.md §684)** — devolutions are subtracted
      with `-ABS(x)`, which is right whichever sign the live `wsir_vnd_vendas` table
      uses, but no refund has been on a running day yet. The next time one is issued,
      confirm invoiced, the staff line, the payment method and the item all drop by
      the refund, and match Wintouch's own dashboard.
- [ ] **Compare the closed-day counters with Wintouch (plan.md §683, §686)** — 23/06
      checked (§686): invoiced, transactions and discounts match the per-document
      PDF (discounts by 1 cent). Customers (52) and Consumptions (363.51) for closed
      days are still derived, not compared, and Wintouch's dashboard only exists for
      the current working day. Check at the end of a working day: note Tally's
      running-day cards (matched to Wintouch's dashboard), and the next day open that
      date on the Day picker — the archive's Customers and Consumptions should equal
      the running-day ones.
- [ ] **Confirm the agent comes back within seconds of a dashboard update
      (plan.md §679)** — with the new setup exe installed, run an Update that
      rebuilds Tally. The shop should show Offline only while the container is
      down and return to Online within ~10 s of it being healthy, and the
      Windows event log should show short retries ("retrying in 00:00:02/04/08"),
      never "token may have been revoked" for a 503.
- [ ] **Run the single-file Tally setup for real, elevated** — plan.md §670.
      Its prompts, `install.config` presets and validation were tested
      un-elevated, and the Docker build of the exe on Linux; the elevated part
      (copying into Program Files, `sc.exe create`/`failure`, starting the
      service) has not run. On `beta`: as an admin, click **Download setup**
      on the Tally page (file named `Wintouch.Tally.Agent-Setup-1.0.0-<hash>.exe`),
      open it (UAC prompt appears), answer the prompts and confirm the service
      is Running and the shop shows connected. Then issue a fresh code and
      open it again over the installed agent: it should stop the service,
      replace the exe, start it on the new token and reconnect — not fail on
      the locked exe or on `sc.exe create`. It must not ask for the URL, the
      Wintouch folder or a code (§681) — only "Keeping the installed settings…". Finally rebuild after touching any
      agent file and confirm the page shows a different version hash.
      Once the new agent is connected, the shops list (Version column), the shop's page and Manage → Agent must
      show its version, still show it after stopping the service, and the
      Manage panel should flag a mismatch with the downloadable version (§672).
- [ ] **Confirm `estado` semantics with a second Wintouch install** — §636
      reads `wsir_mst_mesas.estado` as 0 free, 1 awaiting payment, 2 occupied,
      from the labels on the legacy SQL files plus the live `vallado` data
      (161 at 0, 4 at 2). The legacy Angular read it the other way round. No
      row with `estado = 1` has been seen yet, so the awaiting-payment case is
      inferred rather than observed — worth confirming on a shop that has a
      table with the bill requested.
- [ ] **Verify `hotel-core`'s guest-email scheduler on the live stack** —
      plan.md §651, §652. Everything is proven against a real database in CI:
      the offset math, the flow/active-flag gating, and "a failed send
      leaves the row unmarked so the next tick retries" — but nothing off
      the live stack can prove the one piece that only exists when the app
      is actually exposed: that `HOTEL_CHECKIN_URL` / `HOTEL_PULSE_URL`
      resolve to the real `hotel-checkin`/`hotel-pulse` hostnames (the new
      `additionalExposures.urlEnvKey` mechanism) rather than the
      `localhost:<port>` compose default, and that a real SMTP send through
      them lands a usable link in an inbox. Check on `beta`: set a unit's
      `checkin_is_active` + a real SMTP sender, seed (or wait for the agent
      to sync) a reservation whose check-in date is within the offset, and
      confirm the email arrives with a working `https://hotel-checkin.…`
      link — then the same for a post-checkout quiz email and the
      15-minute agent-down alert. Also confirm the birthday and promo
      flows (§652, no guest link/page, so no exposure dependency): flip a
      unit's `birthday_is_active` + `promo_is_active` on, seed a reservation
      spanning today with a guest whose `birth_date` matches today, and
      confirm both the birthday email and the promo email arrive.
