# Fresh-setup test plan

Verifies that a brand-new deployment — `git clone`, prepare the root `.env`,
`sudo ./start.sh` — comes up correctly.

**Run this on a separate machine (a laptop under WSL), not on `home-srv-01`.**
§4 explains why that is much better, and Appendix A keeps the same-host variant
for reference.

---

## 1. What a separate machine still shares with production

Moving off the server removes almost everything dangerous (§4). One hazard
survives, and it is the worst one, because it is **account-level, not
machine-level**:

### The Cloudflare account and the domain are still shared

If you run the test with the **live** `BASE_DOMAIN` and then enable
*"Publicly expose this service"* in the test dashboard, provisioning will
rewrite the live `CNAME` for e.g. `netbird-vpn.<domain>` to point at the
**test** tunnel. Production breaks instantly, from a different computer.

Two ways to be safe, and they decide how much the test can prove:

| Option | `BASE_DOMAIN` | Exposure | What it proves |
|---|---|---|---|
| **A — same domain** | the live one | **must stay off** | everything up to publishing a route |
| **B — second domain** (recommended) | a different domain in Cloudflare | safe to turn on | **the whole thing, end to end, including NetBird** |

Option B is the real prize: a full end-to-end verification was *impossible* on
the server (any exposure there would have hit production), so this is the first
setup that can genuinely prove NetBird works from scratch.

For option A the guard is the same as before: leave the Nginx Proxy Manager
fields (URL, email, password) **empty** in the test dashboard's Exposure
settings. `start.sh` seeds only the Cloudflare half, never NPM (§47.3), so
provisioning cannot run and the default state is already safe.

The test also creates a **real tunnel** in the real account either way. Delete
it in teardown (§8).

---

## 2. WSL prerequisites — do these first

### 2.1 systemd must be enabled — otherwise the test is meaningless

WSL does not run systemd by default, and the cloudflared steps in `start.sh`
depend on it (lines 127-134 and 349-359). Precisely what happens without it:

- the http2 drop-in file **is** written (that part is just a file write),
- `cloudflared service install` is **attempted and fails**, warning
  `cloudflared service install failed — run it manually`,
- `daemon-reload` and `restart` then fail silently behind `|| true`,
- so **no connector ever runs** — but `start.sh` completes and every other
  check in §5 still passes.

The net effect is a run that looks successful while having tested everything
*except* the part this project spent the most effort on. The single warning is
easy to scroll past, so enable systemd rather than relying on spotting it.

```ini
# /etc/wsl.conf
[boot]
systemd=true
```

Then, from Windows: `wsl --shutdown`, and reopen the distro. Verify:

```bash
systemctl is-system-running
```

Anything other than a hard failure is fine (`running`, or `degraded` — WSL
often reports degraded harmlessly). If you get
`System has not been booted with systemd as init system`, stop and fix it
before going further.

### 2.2 Docker

Use **Docker Engine installed inside the distro**, not Docker Desktop's WSL
integration. `start.sh` runs `systemctl enable --now docker` and writes
`/etc/docker/daemon.json`; with Docker Desktop there is no such service inside
the distro to manage, and the daemon config lives on the Windows side.

Leaving it to `start.sh` is fine — it installs Docker via `get.docker.com` when
`docker` is absent.

### 2.3 Ports

On a clean distro nothing else is on `80`/`3000`, so — unlike the same-host
plan — **leave the ports at their defaults**. Only check that Windows isn't
already serving on `80`.

---

## 3. The run

### 3.1 Clone

Clone **from the remote**, not by copying the server's working tree. That is
the point: it tests what a real user receives, including that the gitignored
files (`users_database.yml`, `data/management.json`, `oidc-secrets.yml`, every
`.env`) really are absent and get regenerated.

```bash
git clone https://github.com/kiko2306/homelab-management.git ~/homelab-management
```

### 3.2 Prepare the root `.env` — the only manual prep

```bash
cd ~/homelab-management && cp .env.example .env && chmod 600 .env
```

Then set **one** value, and deliberately leave the rest alone:

| Key | Set to | Why |
|---|---|---|
| `TUNNEL_NAME` | `setup-test` | see below |

| Key | Leave blank | Why |
|---|---|---|
| `BASE_DOMAIN` | yes | prompted — exercises the prompt path |
| `CLOUDFLARE_API_TOKEN` | yes | prompted, read silently |
| `CLOUDFLARE_ACCOUNT_ID` / `ZONE_ID` / `TUNNEL_ID` | yes | derived by `start.sh` — leaving them blank is what proves derivation works |

Everything else is left at the template's defaults: `start.sh` fills `APPS_DIR`
itself and generates `JWT_SECRET`, `JWT_REFRESH_SECRET` and
`POSTGRES_PASSWORD`, because the template ships them as `change_this_*`.

**Why `TUNNEL_NAME` is worth setting explicitly.** The prompt defaults to
`$(hostname -s)`. On the server that is `home-srv-01` — the production tunnel's
exact name — so pressing Enter there would *reuse* production's tunnel instead
of creating one. On a laptop the hostname differs, so the trap is much weaker,
but setting it keeps the tunnel obviously named and easy to find at teardown.

```bash
sed -i 's/^TUNNEL_NAME=.*/TUNNEL_NAME=setup-test/' .env && grep -E '^(TUNNEL_NAME|BASE_DOMAIN|CLOUDFLARE_API_TOKEN)=' .env
```

### 3.3 Run

```bash
cd ~/homelab-management && sudo ./start.sh
```

It should ask exactly **two** questions: base domain, then the Cloudflare API
token (silent). If it asks a third (tunnel name), §3.2 didn't take.

---

## 4. Why the laptop is the better host — what it removes

Four hazards from the same-host plan disappear entirely, because a separate
machine means a separate Docker daemon:

| Same-host hazard | On a laptop |
|---|---|
| App controls in the test dashboard driving **production's** containers (identical Compose project names — see Appendix A) | **gone** — different daemon, no shared containers |
| `homelab-backend`/`homelab-frontend` image tags being overwritten | **gone** |
| Port collisions on `80`/`3000` | **gone** — use the defaults |
| Tunnel-name default matching production's tunnel | **mostly gone** — different hostname |

What does **not** go away is §1: the shared Cloudflare account and domain.

---

## 5. What must be true afterwards

| # | Check | How |
|---|---|---|
| 1 | Only two prompts appeared | observed during the run |
| 2 | Zone + account ids derived and written back | `grep CLOUDFLARE_ .env` — all three now populated |
| 3 | A **new** tunnel named `setup-test` exists | Cloudflare → Networks → Tunnels |
| 4 | It is remotely-managed (`config_src: cloudflare`) | otherwise exposures would silently 404 (§47.1) |
| 5 | The connector is running and on http2 | `systemctl is-active cloudflared`; `journalctl -u cloudflared \| grep 'Initial protocol'` → `http2` |
| 6 | The http2 drop-in exists | `cat /etc/systemd/system/cloudflared.service.d/10-grpc-http2.conf` |
| 7 | `users_database.yml` created from template, `0600`, warned about | `ls -l apps/authelia/config/users_database.yml` |
| 8 | Authelia's 4 secrets generated | `grep change-me apps/authelia/.env` → no output |
| 9 | OIDC JWKS generated | `grep -c BEGIN apps/authelia/data/oidc-secrets.yml` |
| 10 | `management.json` rendered with no placeholders | `grep -c BASE_DOMAIN apps/netbird-vpn/data/management.json` → `0` |
| 11 | ...with a real 32-byte key | decode `DataStoreEncryptionKey` |
| 12 | `BASE_DOMAIN` written to both app `.env`s | `grep BASE_DOMAIN apps/{authelia,netbird-vpn}/.env` |
| 13 | Exposure settings seeded | query the `settings` table for the 5 keys |
| 14 | Dashboard responds | `curl -o /dev/null -w '%{http_code}' http://localhost` |

**Item 5 is the one that matters most.** It is the fix that took this project
the longest to find (§46), and it is the only item that a systemd-less WSL
would silently skip while still reporting success.

### 5.1 Option B only — the full end-to-end proof

With a second domain, continue past setup and actually finish the job:

1. Change NPM's default login (`admin@example.com` / `changeme`), then enter
   the URL and new credentials in Exposure settings.
2. Enable exposure for **Authelia** and **NetBird VPN**.
3. Set a real Authelia password (§48.6) and log in.
4. Create a setup key in the NetBird dashboard and enrol a client.
5. Confirm gRPC trailers survive the tunnel — the §46 regression:

```bash
printf '\x00\x00\x00\x00\x00' > /tmp/e.grpc && curl -sS --http2 -X POST https://netbird-vpn-api.<test-domain>/management.ManagementService/GetServerKey -H 'content-type: application/grpc' -H 'te: trailers' --data-binary @/tmp/e.grpc -D - -o /dev/null | grep -i grpc-status
```

`grpc-status: 0` means a from-scratch deployment reproduces everything §46-48
established. That is the result worth having.

---

## 6. Production is untouched

Nothing in this plan runs on the server, so the only way to affect it is §1.
Confirm from the server:

```bash
cd /home/mat/www/homelab-management && ./setup_test/snapshot-live.sh setup_test/after.txt
```

The NPM proxy-host list and the cloudflared `ExecStart` must be unchanged. Take
a `before.txt` first if you want a strict diff.

---

## 7. Known limitation to confirm deliberately

`BASE_DOMAIN` must be a **registered Cloudflare zone**. `start.sh` looks it up
with `GET /zones?name=<domain>`, which matches zone names *exactly*, so a
subdomain like `test.example.com` returns nothing and the whole Cloudflare step
is skipped with a warning. Worth running once on purpose as a **negative
test**: it should warn and continue, never hang or half-configure. Supporting a
subdomain base would need a suffix-match fallback.

---

## 8. Teardown

```bash
cd ~/homelab-management && sudo docker compose down -v
```

Then delete the **`setup-test`** tunnel in the Cloudflare dashboard (check the
name twice — do not touch `home-srv-01`). For option B, also remove the DNS
records and NPM hosts the test created, or just leave the second domain as a
permanent staging environment.

---

## Appendix A — running it on `home-srv-01` instead

Only if a second machine isn't available. Four extra hazards apply:

1. **App controls hit production's containers.**
   `backend/src/config/services.ts:711` derives the Compose project name from
   the app's directory, so `apps/netbird-vpn/` is project `netbird-vpn` in
   *any* checkout, and `executor.ts` passes it explicitly with `-p`. Compose
   selects containers by the project **label**, not by which file you pointed
   it at — so pressing Stop in a test dashboard stops **production's**
   containers. Expect the test dashboard to show apps as already *running*;
   that is the symptom. Use only `/setup` and read-only Settings.
2. **Image tags.** `homelab-backend`/`homelab-frontend` are declared with no
   tag and no variable, so a test build overwrites the tags production uses.
   Run at the same commit, and rebuild live afterwards.
3. **Ports.** Set `FRONTEND_PORT=8091`, `BACKEND_PORT=3100` and
   `CORS_ORIGIN=http://localhost:8091` — `80`/`3000` are taken.
4. **`TUNNEL_NAME` must be pre-set** to something other than `home-srv-01`, or
   `start.sh` reuses production's tunnel and seeds its id into the test
   database.

Safe by design there: `cloudflared service install` is skipped because the unit
already exists, so the live connector is never repointed; the http2 drop-in is
rewritten with identical content. Snapshot with `./setup_test/snapshot-live.sh`
before and after and diff.
