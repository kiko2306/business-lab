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

**This test uses a second domain** — a different zone in Cloudflare, not the
live one. That is what makes it safe to turn exposure *on*, which in turn makes
this the first setup that can prove a from-scratch NetBird deployment works end
to end. On the server that was impossible: any exposure there would have hit
production.

Requirements for the second domain:

- it must be a **zone in Cloudflare** (added, nameservers delegated) — see §7,
  a subdomain of the live domain will **not** work;
- it can live in the same Cloudflare account, so the same API token works,
  provided the token's *Zone Resources* actually include it. If the token was
  scoped to the live zone only, either widen it or mint a second one.

Because the domain differs, every hostname the test publishes
(`netbird-vpn.<test-domain>`, ...) is distinct from production's, so DNS and
NPM entries cannot collide.

**The one rule that still matters:** double-check `BASE_DOMAIN` at the prompt
before pressing Enter. Typing the live domain by muscle memory and then
enabling exposure is the single action that would break production.

The test also creates a **real tunnel** in the real account either way. Delete
it in teardown (§8).

---

## 2. WSL prerequisites — do these first

### 2.1 systemd must be enabled — otherwise the test is meaningless

WSL does not run systemd by default, and the Cloudflare Tunnel connector cannot
be installed or started without it — so nothing would be reachable from the
internet, while Docker, the dashboard and all the generated config still come
up fine. A run like that looks successful having skipped exactly the piece this
project spent the most effort on.

**`start.sh` now detects this and warns you**, so you will be told rather than
having to remember. It checks for `/run/systemd/system` (the real marker —
`systemctl` merely *existing* proves nothing on WSL), prints a banner before it
does any work, names WSL specifically with the fix below, skips the connector
install with an explanatory warning rather than a confusing failure, and
repeats the warning as the last thing it prints so it can't scroll away.

Fix it before starting:

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
often reports degraded harmlessly). The check `start.sh` itself uses:

```bash
test -d /run/systemd/system && echo systemd-ok
```

If that prints nothing, `start.sh` will refuse to install the connector and
will say so. Fix it before going further.

### 2.2 Docker and Docker Compose

Use **Docker Engine installed inside the distro**, not Docker Desktop's WSL
integration. `start.sh` runs `systemctl enable --now docker` and writes
`/etc/docker/daemon.json`; under Docker Desktop there is no such service inside
the distro to manage and the daemon config lives on the Windows side, so both
of those steps quietly do nothing.

If Docker Desktop is installed, turn its integration **off** for this distro
first (Docker Desktop → Settings → Resources → WSL Integration), or `docker`
will resolve to the Desktop shim instead of the engine you install below.

Do this **after** §2.1 — the last command needs systemd.

```bash
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null; sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
```

```bash
sudo install -m 0755 -d /etc/apt/keyrings && . /etc/os-release && curl -fsSL "https://download.docker.com/linux/$ID/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

```bash
. /etc/os-release && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
```

```bash
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```bash
sudo systemctl enable --now docker
```

`docker-compose-plugin` is what provides `docker compose` (v2, a subcommand).
The old standalone `docker-compose` binary is not used by this project and is
not needed.

Verify all three before continuing:

```bash
docker --version && docker compose version && sudo docker run --rm hello-world
```

To use `docker` without `sudo`, log out and back in after
`sudo usermod -aG docker "$USER"` — `start.sh` does that for you, but the group
only takes effect in a new shell, so a verification run in the *current* shell
still needs `sudo`.

**If `apt-get update` 404s on the Docker repo**, the release codename is newer
than anything Docker has published for it. Substitute the most recent LTS
codename — e.g. `noble` — in the `sources.list.d/docker.list` line, or skip
this section and let `start.sh` install Docker via `get.docker.com` instead.
Unlikely to bite on WSL, which normally ships an LTS. Check first if unsure:

```bash
. /etc/os-release && curl -fsSI "https://download.docker.com/linux/$ID/dists/$VERSION_CODENAME/Release" | head -1
```

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
git clone https://github.com/kiko2306/business-lab.git ~/business-lab
```

### 3.2 Prepare the root `.env` — the only manual prep

```bash
cd ~/business-lab && cp .env.example .env && chmod 600 .env
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
cd ~/business-lab && sudo ./start.sh
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

### 5.1 The full end-to-end proof

Continue past setup and actually finish the job:

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
cd ~/business-lab && sudo docker compose down -v
```

Then delete the **`setup-test`** tunnel in the Cloudflare dashboard (check the
name twice — do not touch `home-srv-01`). Also remove the DNS records and NPM hosts the
test created — or just leave the second domain in place as a permanent
staging environment, which is arguably the more useful outcome.

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
