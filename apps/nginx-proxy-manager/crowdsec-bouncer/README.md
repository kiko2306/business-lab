# CrowdSec bouncer for Nginx Proxy Manager (vendored)

NPM's nginx is **openresty with ngx_lua** (`nginx -V` shows
`--add-module=../ngx_lua-0.10.31rc2` and LuaJIT), so CrowdSec's Lua bouncer can
run inside NPM itself — a per-request check of the client IP against CrowdSec's
decision stream, 403 for banned IPs. That is the right layer here: every public
request already goes Cloudflare → cloudflared → NPM → app, and NPM has already
resolved the real client IP by the time the check runs (plan.md §110.2, §119).

The `.lua` files below are **vendored, not fetched at build time** — the NPM
image is upstream's and there is nowhere to run an installer, so the code has to
be on disk for the `:ro` mount. Nothing here is edited by hand or by the
backend; the backend only renders `crowdsec-nginx-bouncer.conf` beside them.

## What is vendored, and from where

| Path | Upstream | Version | Licence |
|---|---|---|---|
| `lua/crowdsec.lua`, `lua/plugins/crowdsec/*.lua` | [crowdsecurity/lua-cs-bouncer](https://github.com/crowdsecurity/lua-cs-bouncer) | `v1.0.18` | MIT (`LICENSE.lua-cs-bouncer`) |
| `lua/resty/{http,http_headers,http_connect}.lua` | [ledgetech/lua-resty-http](https://github.com/ledgetech/lua-resty-http) | `v0.17.2` | BSD-2-Clause (`LICENSE.lua-resty-http`) |

`lua-resty-http` is a dependency, not a nicety: `crowdsec.lua` does
`require "resty.http"` and the NPM image's `/etc/nginx/lualib/resty/` does
**not** ship it (it has `redis`, `mysql`, `openssl`, … but no `http`). Without
it `init_by_lua_block` errors and nginx refuses to start. `cjson` and the LuaJIT
`ffi` module, the other two external requires, are both already in the image.

Refreshing either library is a manual step — check the upstream tags, then:

```bash
curl -sSL -o /tmp/lua-cs-bouncer.tar.gz \
  https://github.com/crowdsecurity/lua-cs-bouncer/archive/refs/tags/v1.0.18.tar.gz
tar xzf /tmp/lua-cs-bouncer.tar.gz -C /tmp
cp /tmp/lua-cs-bouncer-1.0.18/lib/crowdsec.lua              lua/
cp /tmp/lua-cs-bouncer-1.0.18/lib/plugins/crowdsec/*.lua    lua/plugins/crowdsec/

curl -sSL -o /tmp/lua-resty-http.tar.gz \
  https://github.com/ledgetech/lua-resty-http/archive/refs/tags/v0.17.2.tar.gz
tar xzf /tmp/lua-resty-http.tar.gz -C /tmp
cp /tmp/lua-resty-http-0.17.2/lib/resty/http*.lua           lua/resty/
```

SHA-256 of the tarballs actually vendored here:

```
87aa148c007b6812f4078ab31dce527a87cbb17edc51ea9cd57aaee2a8314805  lua-cs-bouncer-v1.0.18.tar.gz
3da18ca8582243eff28302591e36651dc7fab046e77336aa4a6fa718bccce4a2  lua-resty-http-v0.17.2.tar.gz
```

## How it is wired

`backend/src/services/crowdsecConfig.ts` owns both moving parts, re-rendered on
every CrowdSec start and whenever the dashboard toggle changes:

- **`crowdsec-nginx-bouncer.conf`** (this directory, gitignored — it holds the
  LAPI key). Mounted into NPM at `/crowdsec/crowdsec-nginx-bouncer.conf`.
  `crowdsec-nginx-bouncer.conf.example` documents the shape.
- **A marker-fenced block in NPM's `data/app/nginx/custom/http_top.conf`** —
  `lua_package_path`, the `crowdsec_cache` shared dict, `init_by_lua_block`,
  `init_worker_by_lua_block` and `access_by_lua_block`. Written only while
  "Enforce CrowdSec bans at NPM" is on, so a stack that never enables it has no
  Lua in nginx at all.

The whole directory is mounted `:ro` at `/crowdsec` — the directory, not the
individual files, so a not-yet-rendered `.conf` cannot make Docker auto-create a
directory where a file belongs.

## Two things that will break nginx if changed carelessly

1. **A missing `crowdsec-nginx-bouncer.conf` is fatal, not degraded.**
   `csmod.init` returns `nil` when the config file does not exist, and the
   upstream `init_by_lua_block` calls `error()` on that — nginx then refuses to
   start, which takes every proxied site down, not just enforcement. The backend
   therefore always writes the `.conf` *before* the block that references it
   (plan.md §99 is the same class of bug).

   **`nginx -t` does not catch this**, which is worth knowing before trusting
   it: `-t` parses the configuration but never executes `init_by_lua_block`.
   Delete `lua/crowdsec.lua` and `nginx -t` still reports "test is successful";
   a real start then dies with a Lua traceback. The backend's check therefore
   starts nginx in a throwaway container and treats "still running a few
   seconds later" as the pass.
2. **`FALLBACK_REMEDIATION=bypass` is not a valid value** in v1.0.18 — the
   config parser accepts only `ban` or `captcha` and silently coerces anything
   else to `ban`. It is also only consulted for *AppSec* failures, which are off
   here (`APPSEC_URL` empty), so the rendered config omits it. Fail-open on a
   CrowdSec outage comes from `MODE=stream` instead: the per-request path only
   reads the local decision cache, and a cache miss returns "allow", so LAPI
   being unreachable means no *new* decisions rather than a blocked site.
