# Fresh-setup test plan

Verifies that a brand-new deployment — `git clone` + `sudo ./start.sh` — comes
up correctly, **without damaging the live stack running on this same host**.

Everything here assumes it is being run on `home-srv-01`, alongside the
production deployment in `/home/mat/www/homelab-management`.

---

## 1. Read this first: what can actually break

The test shares a machine, a Docker daemon, a Cloudflare account and a domain
with production. Five things can cause real damage, in descending order.

### 1.1 App controls in the test dashboard operate on PRODUCTION's containers

The worst one, and the easiest to trigger by accident — someone clicks "Start"
on an app just to see whether the test instance works.

`backend/src/config/services.ts:711` derives the Compose project name from the
app's directory:

```js
const projectName = path.basename(path.dirname(service.composePath));
```

So `apps/netbird-vpn/` is project `netbird-vpn` — **in the test clone and in
production alike** — and `executor.ts` passes it explicitly as
`docker compose -p <projectName> ...`. Compose selects containers by the
`com.docker.compose.project` label, not by which file you pointed it at, so:

```
docker compose -p netbird-vpn -f setup_test/instance/apps/netbird-vpn/docker-compose.yml down
```

stops **production's** NetBird. The same is true of every app.

**Guard:** in the test dashboard, use **only** `/setup` and the read-only
Settings pages. Do not press Start, Stop, Restart or Update on any app, ever.

A direct consequence to expect and not be confused by: the test dashboard will
show apps as already *running*, because it is reading the live daemon's
containers. That is the symptom of this issue, not evidence the test instance
started anything.

### 1.2 Exposure provisioning against the live domain — CATASTROPHIC

If you enable *"Publicly expose this service"* in the **test** dashboard while
its `BASE_DOMAIN` is the live domain, provisioning will:

- rewrite the DNS `CNAME` for e.g. `netbird-vpn.<domain>` to point at the
  **test** tunnel, and
- create/modify proxy hosts on the **same** Nginx Proxy Manager instance
  production uses.

Live services break immediately, including NetBird.

**Guard:** leave the NPM fields (`URL`, email, password) **empty** in the test
dashboard's Exposure settings. Provisioning cannot run without them, so this
failure mode is closed by simply not filling them in. `start.sh` seeds only the
Cloudflare half, never NPM — see §47.3 — so the default state is safe.

**Never** click "expose" on the test instance during this test.

### 1.3 Docker image tag collision

`docker-compose.yml` declares `image: homelab-frontend` and
`image: homelab-backend` with **no tag and no variable** — so they are
`:latest`, and a test `docker compose up --build` rebuilds *those exact tags*.

Running production containers keep the image ID they started with, so nothing
breaks immediately. But the next time the live stack is recreated it picks up
whatever was built last.

**Guard:** run the test from the **same commit** as production, so the rebuilt
image is equivalent. After teardown, rebuild live to be certain:

```bash
cd /home/mat/www/homelab-management && docker compose build && docker compose up -d
```

### 1.4 Port collisions

Ports `80` (frontend) and `3000` (backend) are already taken. The database
publishes no host port, so it is fine. Override the two in the test `.env`
before starting — see §3.

### 1.5 Cloudflare account mutation

The test creates a **real tunnel** in the real account. Harmless, but it must
be deleted in teardown (§6) or it lingers as a confusing "Inactive" entry.

### 1.6 What is safe by design

- `cloudflared service install` is skipped, because `start.sh` only installs it
  when no `cloudflared.service` unit exists — production's does. The live
  connector is never repointed.
- The http2 drop-in is rewritten with identical content, and `start.sh` only
  restarts cloudflared when the guard says the setting was missing.
- `/etc/docker/daemon.json` already exists, so that block is skipped.

These are asserted in §5.2 rather than assumed.

---

## 2. Snapshot production first

```bash
cd /home/mat/www/homelab-management && ./setup_test/snapshot-live.sh setup_test/before.txt
```

Read-only, no credentials. Captures the cloudflared unit + transport, the
drop-ins, running containers, published ports, every NPM proxy host, and the
`homelab-*` image IDs. Re-run it after the test and `diff` — see §5.

---

## 3. Set up the test clone

Clone **from the remote**, not by copying the working tree. This is the point:
it tests what a real user actually receives, including that gitignored files
(`users_database.yml`, `data/management.json`, `oidc-secrets.yml`, every
`.env`) are genuinely absent and get regenerated.

```bash
git clone https://github.com/kiko2306/homelab-management.git /home/mat/www/homelab-management/setup_test/instance
```

Then pre-set the non-conflicting ports, so the interactive run only asks the
three Cloudflare questions:

```bash
cd /home/mat/www/homelab-management/setup_test/instance && cp .env.example .env && sed -i 's/^FRONTEND_PORT=.*/FRONTEND_PORT=8091/; s/^BACKEND_PORT=.*/BACKEND_PORT=3100/; s|^CORS_ORIGIN=.*|CORS_ORIGIN=http://localhost:8091|' .env
```

The compose project name comes from the directory, so containers are
`instance-*` — no collision with `homelab-management-*`.

---

## 4. Run it

```bash
cd /home/mat/www/homelab-management/setup_test/instance && sudo ./start.sh
```

Answer the three prompts:

| Prompt | Use | Why |
|---|---|---|
| Base domain | the **real** domain | it must be a real Cloudflare zone (see §7) |
| Cloudflare API token | the real token | needed for the zone lookup + tunnel create |
| Tunnel name | **`setup-test`** | must NOT be the live tunnel's name, or `start.sh` reuses production's tunnel instead of creating one |

---

## 5. What must be true afterwards

### 5.1 The test instance built itself correctly

| # | Check | Command |
|---|---|---|
| 1 | `users_database.yml` created from the template, `0600` | `ls -l setup_test/instance/apps/authelia/config/users_database.yml` |
| 2 | ...and start.sh warned it holds a placeholder | visible in the run output |
| 3 | Authelia's 4 secrets generated, no `change-me` left | `grep change-me setup_test/instance/apps/authelia/.env` → no output |
| 4 | OIDC JWKS generated | `grep -c BEGIN setup_test/instance/apps/authelia/data/oidc-secrets.yml` |
| 5 | `management.json` rendered, no placeholders | `grep -c BASE_DOMAIN setup_test/instance/apps/netbird-vpn/data/management.json` → `0` |
| 6 | ...with a real 32-byte key | decode `DataStoreEncryptionKey`, expect 32 bytes |
| 7 | `BASE_DOMAIN` written to both app `.env`s | `grep BASE_DOMAIN setup_test/instance/apps/{authelia,netbird-vpn}/.env` |
| 8 | Authelia config validates for that domain | `authelia validate-config` with the `template` filter (recipe in §47.4) |
| 9 | A **new** tunnel exists named `setup-test` | Cloudflare dashboard → Networks → Tunnels |
| 10 | It is remotely-managed | its `config_src` must be `cloudflare`, or exposures would silently 404 (§47.1) |
| 11 | Settings seeded | query the test DB's `settings` table for the 5 keys |
| 12 | Dashboard responds | `curl -o /dev/null -w '%{http_code}' http://localhost:8091` |

### 5.2 Production is untouched — the part that actually matters

```bash
cd /home/mat/www/homelab-management && ./setup_test/snapshot-live.sh setup_test/after.txt && diff setup_test/before.txt setup_test/after.txt
```

Expected differences: **only** the `instance-*` containers and their ports, and
possibly the `homelab-backend`/`homelab-frontend` image IDs (§1.3).

Anything else is a bug in the test setup. In particular these must be
**identical**:

- the cloudflared `ExecStart` (still the live tunnel, still `--protocol http2`)
- `protocol=Initial protocol http2`
- the NPM proxy-host list — *any* change here means §1.2 happened
- `store.db size` for NetBird
- the **full container list** — if any production container is missing,
  §1.1 happened: something was started or stopped from the test dashboard
  and it hit production's project. Restart it from the real dashboard.

Then confirm live services directly:

```bash
for h in netbird-vpn authelia homelab immich; do printf '%-14s %s\n' "$h" "$(curl -sS -o /dev/null -w '%{http_code}' https://$h.tx-home-utils.com/)"; done
```

And that NetBird's gRPC still carries trailers (the §46 regression):

```bash
printf '\x00\x00\x00\x00\x00' > /tmp/e.grpc && curl -sS --http2 -X POST https://netbird-vpn-api.tx-home-utils.com/management.ManagementService/GetServerKey -H 'content-type: application/grpc' -H 'te: trailers' --data-binary @/tmp/e.grpc -D - -o /dev/null | grep -i grpc-status
```

---

## 6. Teardown

```bash
cd /home/mat/www/homelab-management/setup_test/instance && sudo docker compose down -v
```

Then, in order:

1. Delete the **`setup-test`** tunnel in the Cloudflare dashboard (Networks →
   Tunnels → ⋯ → Delete). Check the name twice.
2. `sudo rm -rf /home/mat/www/homelab-management/setup_test/instance`
3. Rebuild live if the test rebuilt the shared image tags (§1.3).
4. Re-run the snapshot diff one final time.

---

## 7. Known limitations this test is expected to surface

These are real gaps, not test-harness problems. Record what actually happens.

- **`BASE_DOMAIN` must be a registered Cloudflare zone.** `start.sh` looks it
  up with `GET /zones?name=<domain>`, which matches zone names *exactly* — so a
  subdomain like `test.example.com` returns nothing and the whole Cloudflare
  step is skipped with a warning. Worth running deliberately as a **negative
  test**: it should warn and continue, never hang or half-configure. If a
  subdomain base is wanted later, the lookup needs a suffix-match fallback.
- **This test cannot prove exposure provisioning works**, because doing so on
  the live domain is exactly the catastrophic case in §1.2. Proving that end to
  end needs a second domain or a second machine. What is proven here is
  everything up to the point of publishing a route.
- **Nor can it prove NetBird works end to end** for the same reason — no
  hostnames get published for the test instance. §46/§48 cover the live proof.
- Production currently carries the older `override.conf` drop-in rather than
  the `10-grpc-http2.conf` that `start.sh` now writes; both set http2, so they
  agree. Expect the test run to add the second file. Once confirmed, the manual
  `override.conf` can be deleted (§46.10).
