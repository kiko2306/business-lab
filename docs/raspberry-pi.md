# Running on a Raspberry Pi (arm64)

The whole stack runs on a Raspberry Pi. Every image the core stack uses is
published multi-arch, the backend has no natively compiled dependencies, and
`start.sh` is architecture-agnostic (it installs Docker via `get.docker.com`,
which supports arm64, and its cloudflared download already branches on
`aarch64|arm64`).

Two things do need attention, and both are handled in this repo:

- **A 64-bit OS is mandatory.** See [Why 64-bit](#why-64-bit) below.
- **`apps/waha` needs a different image tag on ARM.** Set
  `WAHA_IMAGE_TAG=arm` in `apps/waha/.env` — upstream publishes the ARM64
  build under its own tag instead of in a multi-arch manifest. Everything
  else works with no changes.

## Hardware requirements

| | Minimum | Recommended |
|---|---|---|
| Board | Raspberry Pi 4 (4 GB) | Raspberry Pi 5 (8 GB or 16 GB) |
| OS | Raspberry Pi OS **64-bit** (Bookworm) or Ubuntu Server arm64 | same |
| RAM | 4 GB | 8 GB+ |
| Storage | 64 GB microSD (A2) | NVMe SSD over the M.2 HAT+, or a USB3 SSD |
| Power | Official 27 W USB-C PSU (Pi 5) | same, plus the Active Cooler |

**RAM is driven by the build, not the runtime.** `start.sh` compiles the
Angular frontend inside the container (`frontend/Dockerfile`), which is the
single heaviest step of the install. With 4 GB it completes but is tight —
keep swap enabled. On a 2 GB board `ng build` is likely to be OOM-killed; if
that is all you have, build the images on a bigger machine and copy them over
(`docker save` / `docker load`). At runtime the dashboard itself (frontend +
backend + Postgres + socket proxy) is modest; what you run *under* it is what
consumes memory.

**Use an SSD, not a microSD.** The dashboard's Postgres plus every managed
app's own database write continuously. microSD cards wear out fast under that
load, and a corrupted card takes the whole homelab with it.

## Hardware cost

Indicative prices gathered **2026-08-31**. Two caveats before you budget from
this table:

1. The 2026 DRAM and NAND shortages have moved these prices repeatedly — the
   Pi 5 has had three increases since December 2025, and the 8 GB board is
   over twice its original $80 MSRP. Anything here can be stale within weeks.
2. These come from published listings, not from a live check of any one
   vendor's cart. Treat them as a planning estimate and confirm at the
   vendor's own page (linked) before ordering.

### Boards

| Item | Price | Vendor |
|---|---|---|
| Raspberry Pi 5 — 4 GB | ~$100 | [CanaKit](https://www.canakit.com/raspberry-pi-5-4gb.html) · [PiShop.us](https://www.pishop.us/product-category/raspberry-pi/raspberry-pi-5/) |
| **Raspberry Pi 5 — 8 GB** | **$175** / £140 | [CanaKit](https://www.canakit.com/raspberry-pi-5-8gb.html) · [PiShop.us](https://www.pishop.us/product/raspberry-pi-5-8gb/) · [Pimoroni](https://shop.pimoroni.com/en-us/products/raspberry-pi-5) · [Seeed](https://www.seeedstudio.com/Raspberry-Pi-5-8GB-p-5810.html) |
| Raspberry Pi 5 — 16 GB | $305 / £244 | [CanaKit](https://www.canakit.com/raspberry-pi-5-16gb.html) · [PiShop.us](https://www.pishop.us/product/raspberry-pi-5-16gb/) |
| Raspberry Pi 4 — 3 GB (budget) | $83.75 | [Official announcement](https://www.raspberrypi.com/news/a-new-3gb-raspberry-pi-4-for-83-75-and-more-memory-driven-price-increases/) |

### Accessories

| Item | Price | Vendor |
|---|---|---|
| 27 W USB-C PSU (required for Pi 5) | ~$12–15 | [Raspberry Pi](https://www.raspberrypi.com/products/27w-power-supply/) · [Adafruit](https://www.adafruit.com/product/5814) · [CanaKit](https://www.canakit.com/official-raspberry-pi-5-power-supply-27w-usb-c.html) |
| Active Cooler | $5 | [Raspberry Pi](https://www.raspberrypi.com/products/active-cooler/) · [Adafruit](https://www.adafruit.com/product/5815) · [CanaKit](https://www.canakit.com/raspberry-pi-5-active-cooler.html) |
| M.2 HAT+ (NVMe carrier) | $12 | [Raspberry Pi](https://www.raspberrypi.com/products/m2-hat-plus/) · [The Pi Hut](https://thepihut.com/products/raspberry-pi-m2-hat-plus) |
| M.2 HAT+ Compact | $15 | [Announcement](https://www.raspberrypi.com/news/m-2-hat-compact-on-sale-now-at-15/) |
| Official case | ~$10–15 | [PiShop.us](https://www.pishop.us/product-category/raspberry-pi/raspberry-pi-5/) |
| NVMe SSD, 1 TB | ~$105 | [SSD price tracker](https://cheapestssd.com/) · [Tom's Hardware tracker](https://www.tomshardware.com/pc-components/ssds/ssd-price-tracking-2026-lowest-price-on-every-m-2-ssd) |
| microSD A2 V30, 64 GB | $15 | [Raspberry Pi](https://www.raspberrypi.com/products/sd-cards/) · [PiShop.us](https://www.pishop.us/product/raspberry-pi-sd-card-64gb/) |

### Complete builds

| Build | Parts | Total |
|---|---|---|
| **Recommended** | Pi 5 8 GB + 27 W PSU + Active Cooler + M.2 HAT+ + 1 TB NVMe + case | **~$325** |
| Headroom | Pi 5 16 GB + same accessories | ~$455 |
| Budget | Pi 5 4 GB + 64 GB microSD + PSU + cooler + case | ~$145 |
| Pre-assembled kit | [CanaKit Pi 5 4 GB starter kit](https://www.canakit.com/canakit-raspberry-pi-5-starter-kit-turbine-black.html) (PSU, case, microSD included) | $204.95 |

### Worth knowing before you buy

At ~$325 for the recommended build, a Pi 5 is **no longer the cheapest way to
run this stack**. An Intel N100/N150 mini PC with 16 GB RAM and an SSD lands
in the $180–340 range, runs the amd64 images this repo is already deployed
against, has no arm64 caveats at all, and gives you far more headroom for the
heavier managed apps. The Pi still wins on idle power draw (~5–10 W vs
~10–15 W), physical size, silence, and GPIO — pick it for those reasons, not
to save money in 2026.

### Buying in Portugal / EU

Approved resellers and comparison sites with EUR pricing:
[PcComponentes.pt](https://www.pccomponentes.pt/raspberry-pi-5-8gb) ·
[RasPi Shop PT](https://raspishop.pt/c/robotica-e-desenvolvimento/raspberry-pi-robotica-e-desenvolvimento/placas-e-kits/raspberry-pi-5/) ·
[Electrofun](https://www.electrofun.pt/raspberry-pi) ·
[Farnell PT](https://pt.farnell.com/buy-raspberry-pi) ·
[KuantoKusta (price comparison)](https://www.kuantokusta.pt/marcas/Raspberry-Pi)

Buy from an [approved reseller](https://www.raspberrypi.com/products/raspberry-pi-5/)
rather than a marketplace listing — the 2026 shortage has pushed a lot of
above-MSRP resale onto Amazon and eBay.

## Install

Identical to the normal path — see [Quick start](/README.md#quick-start):

```bash
git clone <this repo> && cd homelab-management
sudo ./start.sh
```

`start.sh` uses `apt-get`, which Raspberry Pi OS provides, and installs Docker
and the Compose plugin the same way it does on any Debian host.

One ARM-only step, and only if you use WAHA:

```bash
echo "WAHA_IMAGE_TAG=arm" >> apps/waha/.env
```

## Why 64-bit

The core stack itself would run on 32-bit (`node`, `nginx`, `postgres` and
`docker-socket-proxy` all publish `arm/v7` images), but a large share of the
managed apps publish **arm64 only**: paperless-ngx, immich, home-assistant,
jellyfin, mealie, homepage, stirling-pdf, n8n, nginx-proxy-manager, and every
`linuxserver/*` image. On a 32-bit OS those fail at pull time with
`no matching manifest for linux/arm/v7`. Install the 64-bit image.

## Managed app compatibility

Verified against each image's registry manifest on 2026-08-31.

| App | arm64 | armv7 (32-bit) | Notes |
|---|---|---|---|
| authelia, dozzle, ntfy, crowdsec, filebrowser, netbird-vpn, nocodb, pihole, tailscale, uptime-kuma, vaultwarden, vikunja, beszel | yes | yes | |
| bookstack, code-server, duplicati, grocy, speedtest (`linuxserver/*`) | yes | **no** | arm64-only images |
| paperless, mealie, home-page, home-assistant, n8n, stirling-pdf, nginx-proxy-manager | yes | **no** | arm64-only images |
| jellyfin | yes | **no** | no hardware transcoding configured (no `/dev/dri` in the compose) — transcoding is CPU-only and will struggle |
| immich | yes | **no** | `immich-machine-learning` is heavy; expect slow face/object indexing |
| nextcloud | yes | yes | usable but sluggish on a Pi under load |
| pantry, price-compare | yes | yes | built locally from `node:20-alpine`, pure-JS dependencies |
| kitchen-switcher | yes | yes | static `nginx:alpine` |
| **waha** | **yes, with `WAHA_IMAGE_TAG=arm`** | no | `latest` is amd64-only |

## Performance notes

- **Immich machine learning, Nextcloud and Jellyfin transcoding** are the
  three workloads that will actually strain a Pi. They run; they are not fast.
- **Pi-hole binds port 53.** Raspberry Pi OS does not run `systemd-resolved`
  by default, so there is usually no conflict — but check with
  `sudo ss -ulpn | grep :53` before starting it.
- **Frontend image build** downloads no browser: `PUPPETEER_SKIP_DOWNLOAD=1`
  is set in `frontend/Dockerfile`, because `@puppeteer/browsers` maps every
  Linux host to the x86_64 Chrome build regardless of CPU and would otherwise
  pull ~170 MB of a binary that cannot run on ARM.
