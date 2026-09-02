#!/usr/bin/env bash
# One-time host bootstrap: installs Docker if missing, widens the daemon's
# address-pool, pins the cloudflared http2 transport, and offers a couple of
# prompted host-level changes (a fixed IP, dropping the sudo password prompt
# for the invoking user). Nothing here is app- or stack-specific — that half
# of bootstrapping (`.env` generation, per-app secrets, Cloudflare/NetBird
# setup, starting the stack) lives in start.sh, which sources this file.
#
# Must be run with sudo (or as root): it installs system packages, manages
# the docker system service, edits sudoers, and can reconfigure networking.
#
# Safe to source from another script (start.sh does) or run standalone:
#   sudo ./setup_server.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

log() { printf '==> %s\n' "$1"; }
warn() { printf 'warning: %s\n' "$1" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  echo "error: this script installs system packages and manages services — run it with sudo:" >&2
  echo "  sudo ./setup_server.sh" >&2
  exit 1
fi

# The real, non-root user who ran `sudo ./setup_server.sh` (or `sudo
# ./start.sh`, which sources this) — added to the docker group at the end so
# they don't need sudo for docker/compose afterwards. Falls back to "root" if
# invoked directly as root (e.g. a root login shell), in which case there is
# no separate user to add to the group.
TARGET_USER="${SUDO_USER:-root}"

# Whether systemd is actually running as PID 1 — not merely whether the
# systemctl binary exists. WSL ships systemctl but does not boot systemd unless
# it is explicitly turned on, and everything to do with the Cloudflare Tunnel
# connector below depends on it. /run/systemd/system is the canonical marker.
HAS_SYSTEMD=0
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  HAS_SYSTEMD=1
fi

IS_WSL=0
if grep -qi 'microsoft\|WSL' /proc/version 2>/dev/null; then
  IS_WSL=1
fi

# Warn up front rather than letting this be discovered later. Without systemd
# the tunnel connector is never installed or started, yet everything else here
# still succeeds — so the run looks fine while the one piece that publishes
# this host to the internet is missing.
if [ "$HAS_SYSTEMD" -eq 0 ]; then
  echo >&2
  echo "=============================================================" >&2
  echo " WARNING: systemd is not running as PID 1." >&2
  echo >&2
  echo " The Cloudflare Tunnel connector cannot be installed or" >&2
  echo " started without it, so nothing on this host will be" >&2
  echo " reachable from the internet. Everything else — Docker, the" >&2
  echo " dashboard, the generated config — will still come up, so" >&2
  echo " this is easy to miss." >&2
  if [ "$IS_WSL" -eq 1 ]; then
    echo >&2
    echo " Detected WSL, which does not enable systemd by default." >&2
    echo " To fix, add to /etc/wsl.conf:" >&2
    echo >&2
    echo "     [boot]" >&2
    echo "     systemd=true" >&2
    echo >&2
    echo " then from Windows run 'wsl --shutdown', reopen the distro," >&2
    echo " and re-run this script. Verify with:" >&2
    echo "     test -d /run/systemd/system && echo systemd-ok" >&2
  fi
  echo "=============================================================" >&2
  echo >&2
fi

if command -v apt-get >/dev/null 2>&1; then
  APT_MISSING=()
  for bin_pkg in "curl:curl" "openssl:openssl" "gnupg:gnupg" "ca-certificates:ca-certificates" "python3:python3"; do
    bin="${bin_pkg%%:*}"
    pkg="${bin_pkg##*:}"
    if ! command -v "$bin" >/dev/null 2>&1; then
      APT_MISSING+=("$pkg")
    fi
  done
  if [ "${#APT_MISSING[@]}" -gt 0 ]; then
    log "Installing missing packages: ${APT_MISSING[*]}"
    apt-get update -qq
    apt-get install -y -qq "${APT_MISSING[@]}"
  fi
else
  warn "No 'apt-get' found — this script only automates dependency installation on Ubuntu/Debian."
  warn "Continuing on the assumption docker, docker compose, openssl, and curl are already installed."
fi

for bin in curl openssl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is required but not found on PATH, and could not be installed automatically." >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via the official Docker install script (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi

if command -v systemctl >/dev/null 2>&1; then
  log "Enabling and starting the docker service"
  systemctl enable --now docker >/dev/null 2>&1 || warn "couldn't enable/start the docker service via systemctl — is it running already under a different init system?"
fi

# Every managed app is its own compose project with its own bridge network.
# Docker's default address pool only fits ~31 user networks before
# `all predefined address pools have been fully subnetted` and new apps can't
# start. Widen it — /24 networks out of a couple of /16 bases = 512 slots.
# 10.201/16 is picked to be unlikely to clash with a home LAN.
DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
if [ ! -f "$DOCKER_DAEMON_JSON" ]; then
  log "Setting a wider Docker default-address-pool (per-app networks) in $DOCKER_DAEMON_JSON"
  mkdir -p /etc/docker
  cat > "$DOCKER_DAEMON_JSON" <<'JSON'
{
  "default-address-pools": [
    { "base": "10.201.0.0/16", "size": 24 },
    { "base": "172.31.0.0/16", "size": 24 }
  ]
}
JSON
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart docker >/dev/null 2>&1 && log "restarted docker to apply the address-pool change" \
      || warn "couldn't restart docker — apply $DOCKER_DAEMON_JSON and restart it manually"
  else
    warn "restart the Docker daemon to apply $DOCKER_DAEMON_JSON"
  fi
elif ! grep -q 'default-address-pools' "$DOCKER_DAEMON_JSON"; then
  warn "$DOCKER_DAEMON_JSON exists without 'default-address-pools' — add one (see the block setup_server.sh would write) or new app networks will eventually fail with 'all predefined address pools have been fully subnetted'"
fi

# --- Optional: grow the volume group onto another disk -----------------------
# Ubuntu's installer sizes the volume group to the disk it installs on, so a
# second disk added later is invisible to the running system until something
# claims it (plan.md §87).
#
#   sudo EXPAND_VG_DISK=/dev/sdX ./setup_server.sh
#
# This is the one storage job the dashboard cannot do for itself: the backend
# runs off the very filesystem being grown, out of a container whose image
# lives on it. So it belongs here, with the rest of the host bootstrap, rather
# than behind a button.
#
# **It destroys everything on the named disk.** Opt-in, refuses any disk that
# has a mounted filesystem or belongs to another volume group, and asks for
# typed confirmation unless EXPAND_VG_ASSUME_YES=1.
#
# Runs before the DOCKER_DATA_ROOT move below, so that a host being given both
# a bigger disk and a relocated Docker root has the space before the copy
# starts rather than after it.
#
# The disk becomes a *whole-disk* physical volume, with no partition table.
# That is deliberate: it removes the two steps of this path most likely to
# behave differently on a machine than in review — sfdisk's type shortcuts,
# which moved between util-linux versions, and waiting on udev to publish the
# new partition node before pvcreate can open it. LVM has taken whole disks
# since forever, and `lsblk` still shows the disk as an LVM2_member.
#
# Idempotent: a disk already in the target volume group skips straight to the
# grow, so a second run with the same value only takes up any free extents.
EXPAND_VG_DISK="${EXPAND_VG_DISK:-}"
if [ -n "$EXPAND_VG_DISK" ]; then
  # Which filesystem grows. /home by default because that is where Docker's
  # data root and containerd's root live once §83's move has run, and so where
  # every app's data actually is.
  EXPAND_VG_TARGET="${EXPAND_VG_TARGET:-/home}"

  for tool in findmnt lsblk wipefs pvs vgs lvs pvcreate vgextend lvextend; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "error: '$tool' is needed to grow the volume group." >&2
      echo "       sudo apt-get install -y lvm2 e2fsprogs util-linux" >&2
      exit 1
    fi
  done

  if [ ! -b "$EXPAND_VG_DISK" ]; then
    echo "error: $EXPAND_VG_DISK is not a block device." >&2
    echo "       'lsblk -dno NAME,SIZE,MODEL' lists the disks on this host." >&2
    exit 1
  fi

  # Derive the volume group and logical volume from what is actually mounted,
  # rather than taking them as input: naming the wrong LV here would grow a
  # filesystem nobody asked about.
  EXPAND_SOURCE="$(findmnt -no SOURCE --target "$EXPAND_VG_TARGET" 2>/dev/null || true)"
  if [ -z "$EXPAND_SOURCE" ]; then
    echo "error: nothing is mounted at or above $EXPAND_VG_TARGET." >&2
    exit 1
  fi
  EXPAND_VG="$(lvs --noheadings -o vg_name "$EXPAND_SOURCE" 2>/dev/null | tr -d ' ' || true)"
  EXPAND_LV="$(lvs --noheadings -o lv_name "$EXPAND_SOURCE" 2>/dev/null | tr -d ' ' || true)"
  if [ -z "$EXPAND_VG" ] || [ -z "$EXPAND_LV" ]; then
    echo "error: $EXPAND_VG_TARGET is on $EXPAND_SOURCE, which is not an LVM logical volume." >&2
    echo "       Only LVM can be grown onto a second disk in place; a plain partition cannot." >&2
    exit 1
  fi

  # How the filesystem is grown depends on what it is. Both are online.
  EXPAND_FSTYPE="$(findmnt -no FSTYPE --target "$EXPAND_VG_TARGET")"
  case "$EXPAND_FSTYPE" in
    ext2|ext3|ext4)
      command -v resize2fs >/dev/null 2>&1 || { echo "error: resize2fs is missing (apt-get install e2fsprogs)" >&2; exit 1; } ;;
    xfs)
      command -v xfs_growfs >/dev/null 2>&1 || { echo "error: xfs_growfs is missing (apt-get install xfsprogs)" >&2; exit 1; } ;;
    *)
      echo "error: don't know how to grow a $EXPAND_FSTYPE filesystem online." >&2
      exit 1 ;;
  esac

  # Is the disk already ours? Then this is a repeat run and there is nothing to
  # erase. Any other volume group means the disk is in use by something this
  # script has no business overwriting.
  EXPAND_DISK_VG="$(pvs --noheadings -o pv_name,vg_name 2>/dev/null |
    awk -v d="$EXPAND_VG_DISK" '$1 == d { print $2 }' | head -1 || true)"

  if [ "$EXPAND_DISK_VG" = "$EXPAND_VG" ]; then
    log "$EXPAND_VG_DISK is already part of $EXPAND_VG — taking up any free space"
  else
    if [ -n "$EXPAND_DISK_VG" ]; then
      echo "error: $EXPAND_VG_DISK is a physical volume in volume group '$EXPAND_DISK_VG'." >&2
      echo "       Remove it from that group first if you really mean to reuse the disk." >&2
      exit 1
    fi

    # Anything mounted from this disk, or any of its partitions, and it is not
    # a spare — whatever the operator believes.
    EXPAND_MOUNTED="$(lsblk -nro MOUNTPOINT "$EXPAND_VG_DISK" 2>/dev/null | grep -v '^$' || true)"
    if [ -n "$EXPAND_MOUNTED" ]; then
      echo "error: $EXPAND_VG_DISK has mounted filesystems and will not be erased:" >&2
      echo "$EXPAND_MOUNTED" | sed 's/^/       /' >&2
      exit 1
    fi

    if [ "${EXPAND_VG_ASSUME_YES:-}" != "1" ]; then
      if [ ! -t 0 ]; then
        echo "error: refusing to erase $EXPAND_VG_DISK with no terminal to confirm on." >&2
        echo "       Set EXPAND_VG_ASSUME_YES=1 if you are certain." >&2
        exit 1
      fi
      echo
      echo "About to ERASE this disk and add it to volume group '$EXPAND_VG':"
      lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$EXPAND_VG_DISK"
      echo
      printf 'Type the disk name (%s) to confirm, anything else to abort: ' "$EXPAND_VG_DISK"
      read -r EXPAND_CONFIRM
      if [ "$EXPAND_CONFIRM" != "$EXPAND_VG_DISK" ]; then
        echo "Aborted — nothing was changed."
        exit 1
      fi
    fi

    log "Erasing $EXPAND_VG_DISK and adding it to $EXPAND_VG"
    # -a clears every signature it finds, including the protective MBR a GPT
    # disk carries; without it pvcreate sees a partition table and balks.
    wipefs -a "$EXPAND_VG_DISK"
    pvcreate -ff -y "$EXPAND_VG_DISK"
    vgextend "$EXPAND_VG" "$EXPAND_VG_DISK"
  fi

  EXPAND_FREE="$(vgs --noheadings -o vg_free_count "$EXPAND_VG" 2>/dev/null | tr -d ' ' || echo 0)"
  if [ "${EXPAND_FREE:-0}" -gt 0 ]; then
    EXPAND_BEFORE="$(df -h --output=size "$EXPAND_VG_TARGET" | tail -1 | tr -d ' ')"
    lvextend -l +100%FREE "/dev/$EXPAND_VG/$EXPAND_LV"
    if [ "$EXPAND_FSTYPE" = "xfs" ]; then
      xfs_growfs "$EXPAND_VG_TARGET"
    else
      resize2fs "/dev/$EXPAND_VG/$EXPAND_LV"
    fi
    log "$EXPAND_VG_TARGET grew from $EXPAND_BEFORE to $(df -h --output=size "$EXPAND_VG_TARGET" | tail -1 | tr -d ' ')"
  else
    log "$EXPAND_VG has no free extents — $EXPAND_VG_TARGET is already at full size"
  fi

  # Spanning a volume group across two disks with no redundancy doubles the
  # number of devices whose failure loses the whole filesystem. Say so out
  # loud, every run, because the person doing this is usually thinking about
  # capacity and not about that.
  warn "$EXPAND_VG now spans more than one disk with no redundancy — if either fails, $EXPAND_VG_TARGET is lost. Check the backups actually run."
fi

# --- Optional: move Docker's storage to another filesystem -------------------
# Ubuntu's installer hands root ~100 GiB and gives the rest of the disk to
# /home, so a machine with plenty of free space can still run Docker out of
# room (plan.md §83).
#
#   sudo DOCKER_DATA_ROOT=/home/docker ./setup_server.sh
#
# Moves BOTH roots that matter. With Docker's containerd image store — the
# default on recent installs, `Storage Driver: overlayfs` with driver-type
# io.containerd.snapshotter.v1 — image layers live in *containerd's* root, and
# Docker's data-root holds only containers, volumes, networks and buildkit.
# Moving data-root alone relocated 100 MB here and left 45 GB behind (§83.6),
# so "move Docker's storage" has to mean the bytes. containerd's target
# defaults to a sibling of the given path; override with CONTAINERD_ROOT.
#
# Opt-in, never automatic: this stops the daemon and copies tens of gigabytes.
# Idempotent — a root already in the right place is skipped, so a second run
# with the same value is a no-op. Old trees are left in place, so rollback is
# removing the key from the config and restarting.
DOCKER_DATA_ROOT="${DOCKER_DATA_ROOT:-}"
if [ -n "$DOCKER_DATA_ROOT" ]; then
  case "$DOCKER_DATA_ROOT" in
    /*) ;;
    *) echo "error: DOCKER_DATA_ROOT must be an absolute path (got '$DOCKER_DATA_ROOT')" >&2; exit 1 ;;
  esac

  CURRENT_DATA_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -z "$CURRENT_DATA_ROOT" ]; then
    echo "error: can't read Docker's current data root — is the daemon running?" >&2
    exit 1
  fi

  # Only when the containerd snapshotter is in use is containerd's root the
  # place the images actually are.
  CONTAINERD_ROOT="${CONTAINERD_ROOT:-$(dirname "$DOCKER_DATA_ROOT")/containerd}"
  CURRENT_CONTAINERD_ROOT=""
  if docker info 2>/dev/null | grep -q 'io.containerd.snapshotter.v1'; then
    CURRENT_CONTAINERD_ROOT="$(containerd config dump 2>/dev/null | awk -F'[=[:space:]]+' '/^root[[:space:]]*=/ {gsub(/['"'"'"]/, "", $2); print $2; exit}')"
    CURRENT_CONTAINERD_ROOT="${CURRENT_CONTAINERD_ROOT:-/var/lib/containerd}"
  fi

  # "source|target|label" for each root that is not already where it belongs.
  MOVES=()
  [ "$CURRENT_DATA_ROOT" != "$DOCKER_DATA_ROOT" ] && MOVES+=("$CURRENT_DATA_ROOT|$DOCKER_DATA_ROOT|docker")
  if [ -n "$CURRENT_CONTAINERD_ROOT" ] && [ "$CURRENT_CONTAINERD_ROOT" != "$CONTAINERD_ROOT" ]; then
    MOVES+=("$CURRENT_CONTAINERD_ROOT|$CONTAINERD_ROOT|containerd")
  fi

  if [ "${#MOVES[@]}" -eq 0 ]; then
    log "Docker storage is already where it should be — nothing to move"
  else
    if [ "$HAS_SYSTEMD" -eq 0 ]; then
      echo "error: moving Docker's storage needs systemd to stop and start the daemons cleanly." >&2
      exit 1
    fi

    if ! command -v rsync >/dev/null 2>&1; then
      if command -v apt-get >/dev/null 2>&1; then
        log "Installing rsync (needed to copy the storage trees)"
        apt-get update -qq
        apt-get install -y -qq rsync
      else
        echo "error: rsync is required to move the storage trees and could not be installed." >&2
        exit 1
      fi
    fi

    # Preflight everything before stopping anything. -x measures only the
    # tree's own filesystem, not the live overlay mounts underneath it.
    TOTAL_NEED_KB=0
    for move in "${MOVES[@]}"; do
      SRC="${move%%|*}"; REST="${move#*|}"; DST="${REST%%|*}"
      case "$DST/" in
        "$SRC"/*) echo "error: $DST is inside $SRC — it would copy into itself" >&2; exit 1 ;;
      esac
      TOTAL_NEED_KB=$(( TOTAL_NEED_KB + $(du -sxk "$SRC" | awk '{print $1}') ))
    done
    NEED_WITH_MARGIN_KB=$(( TOTAL_NEED_KB + TOTAL_NEED_KB / 10 ))
    for move in "${MOVES[@]}"; do
      REST="${move#*|}"; DST="${REST%%|*}"
      mkdir -p "$DST"
      FREE_KB="$(df -Pk "$DST" | awk 'NR==2 {print $4}')"
      if [ "$FREE_KB" -lt "$NEED_WITH_MARGIN_KB" ]; then
        echo "error: not enough room at $DST." >&2
        echo "       need $(( NEED_WITH_MARGIN_KB / 1024 )) MiB (data + 10% margin), have $(( FREE_KB / 1024 )) MiB" >&2
        exit 1
      fi
    done

    # Recorded while the daemon is still up, to be compared after the restart.
    IMAGES_BEFORE="$(docker image ls -aq | wc -l)"
    CONTAINERS_BEFORE="$(docker ps -aq | wc -l)"

    log "Moving $(( TOTAL_NEED_KB / 1024 )) MiB of Docker storage. Every container stops until this finishes — including this dashboard."

    # docker.socket too: stopping only the service leaves systemd ready to
    # start the daemon again the moment anything touches the socket, which
    # would be in the middle of the copy. containerd last — Docker sits on it.
    systemctl stop docker.socket docker
    [ -n "$CURRENT_CONTAINERD_ROOT" ] && systemctl stop containerd

    for move in "${MOVES[@]}"; do
      SRC="${move%%|*}"; REST="${move#*|}"; DST="${REST%%|*}"; KIND="${REST#*|}"
      log "  $KIND: $SRC -> $DST"
      # -H is not optional: both trees are full of hard links, and copying
      # without it inflates the result and breaks layer sharing. -A/-X keep
      # ACLs and xattrs; --numeric-ids avoids remapping ownership.
      rsync -aHAX --numeric-ids --info=progress2 "$SRC"/ "$DST"/
    done

    for move in "${MOVES[@]}"; do
      REST="${move#*|}"; DST="${REST%%|*}"; KIND="${REST#*|}"
      if [ "$KIND" = "docker" ]; then
        # Merge rather than rewrite — default-address-pools lives here too.
        python3 - "$DOCKER_DAEMON_JSON" "$DST" <<'PYJSON'
import json, os, sys

path, data_root = sys.argv[1], sys.argv[2]
config = {}
if os.path.exists(path):
    with open(path) as handle:
        text = handle.read().strip()
    if text:
        config = json.loads(text)
config['data-root'] = data_root
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as handle:
    json.dump(config, handle, indent=2)
    handle.write('\n')
PYJSON
      else
        # TOML: `root` is a top-level key, so it has to land before the first
        # table header or it silently becomes that table's key.
        python3 - /etc/containerd/config.toml "$DST" <<'PYTOML'
import os, sys

path, root = sys.argv[1], sys.argv[2]
lines = []
if os.path.exists(path):
    with open(path) as handle:
        lines = handle.read().splitlines()

out, done = [], False
for line in lines:
    stripped = line.strip()
    if not done and stripped.split('#')[0].strip().startswith('root') and '=' in stripped:
        if stripped.split('=')[0].strip() == 'root':
            out.append(f'root = "{root}"')
            done = True
            continue
    if not done and stripped.startswith('['):
        out.append(f'root = "{root}"')
        done = True
    out.append(line)
if not done:
    out.append(f'root = "{root}"')

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w') as handle:
    handle.write('\n'.join(out) + '\n')
PYTOML
      fi
    done

    [ -n "$CURRENT_CONTAINERD_ROOT" ] && systemctl start containerd
    systemctl start docker
    for _ in $(seq 1 60); do
      docker info >/dev/null 2>&1 && break
      sleep 1
    done

    NEW_DATA_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
    if [ "$NEW_DATA_ROOT" != "$DOCKER_DATA_ROOT" ]; then
      echo "error: Docker came back on $NEW_DATA_ROOT, not $DOCKER_DATA_ROOT." >&2
      echo "       Check $DOCKER_DAEMON_JSON, /etc/containerd/config.toml and 'journalctl -u docker'." >&2
      echo "       The original trees are untouched, so reverting the config keys restores them." >&2
      exit 1
    fi

    IMAGES_AFTER="$(docker image ls -aq | wc -l)"
    CONTAINERS_AFTER="$(docker ps -aq | wc -l)"
    if [ "$IMAGES_AFTER" != "$IMAGES_BEFORE" ] || [ "$CONTAINERS_AFTER" != "$CONTAINERS_BEFORE" ]; then
      warn "counts differ after the move: images $IMAGES_BEFORE -> $IMAGES_AFTER, containers $CONTAINERS_BEFORE -> $CONTAINERS_AFTER"
      warn "the old trees are intact — do not delete them until this is understood"
    else
      log "Storage moved: $IMAGES_BEFORE images and $CONTAINERS_BEFORE containers accounted for"
    fi

    log "The old trees are still in place. Once you're happy, reclaim them with:"
    for move in "${MOVES[@]}"; do
      log "  sudo rm -rf ${move%%|*}"
    done
  fi
fi

# NetBird's native gRPC management API only survives the Cloudflare Tunnel if
# the connector is pinned to HTTP/2. (Signal is a separate problem the http2
# transport does NOT solve — it goes over Tailscale Funnel; see the Funnel
# phase near the end of this script and plan.md §52/§53.) cloudflared's default QUIC
# backbone silently drops HTTP/2 trailers: gRPC responses still arrive as a
# 200 with a correct body, but with no grpc-status trailer, so grpc-go reports
# "server closed the stream without sending trailers" and NetBird clients
# retry the same call forever with nothing in any log looking like an error.
# The setting lives in a systemd drop-in — host state this repo doesn't
# otherwise own — so re-assert it on every bootstrap, or a rebuilt host
# silently loses it. See plan.md §46.
#
# Deliberately written as an environment variable rather than by rewriting
# ExecStart with --protocol: cloudflared is NOT installed by this script (it's
# a separate host service), so on a fresh machine it usually doesn't exist yet
# at this point. systemd applies drop-ins whenever the unit later appears, so
# an Environment= drop-in works regardless of install order, and needs to know
# nothing about the unit's ExecStart (whose token path/flags vary per host).
# An explicit --protocol flag on the command line still wins over this, so a
# deliberate per-host choice is not overridden.
CF_DROPIN_DIR="/etc/systemd/system/cloudflared.service.d"
CF_DROPIN="$CF_DROPIN_DIR/10-grpc-http2.conf"
if [ ! -f "$CF_DROPIN" ] || ! grep -q 'TUNNEL_TRANSPORT_PROTOCOL=http2' "$CF_DROPIN" 2>/dev/null; then
  log "Pinning cloudflared to the http2 transport (gRPC trailers; see plan.md §46)"
  mkdir -p "$CF_DROPIN_DIR"
  cat > "$CF_DROPIN" <<'UNIT'
# Managed by setup_server.sh — see plan.md §46.
# cloudflared's default QUIC backbone silently drops HTTP/2 trailers, which
# breaks every gRPC service behind the tunnel (NetBird management; signal now
# goes over Tailscale Funnel instead, see the Funnel phase below):
# responses arrive as a 200 with a correct body but no grpc-status trailer, and
# clients then retry forever with nothing that looks like an error in any log.
[Service]
Environment=TUNNEL_TRANSPORT_PROTOCOL=http2
UNIT
fi
# Apply it now only if cloudflared is actually installed here; otherwise the
# drop-in just sits waiting for whenever it gets installed.
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    systemctl restart cloudflared >/dev/null 2>&1 \
      && log "restarted cloudflared on the http2 transport" \
      || warn "wrote $CF_DROPIN but couldn't restart cloudflared — restart it manually"
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Docker Compose plugin not found — installing docker-compose-plugin"
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "error: 'docker compose' (the Compose plugin) is required and could not be installed automatically." >&2
    exit 1
  fi
fi

if [ "$TARGET_USER" != "root" ] && ! id -nG "$TARGET_USER" 2>/dev/null | grep -qw docker; then
  log "Adding user '$TARGET_USER' to the docker group (log out and back in for this to take effect)"
  usermod -aG docker "$TARGET_USER"
fi

# --- Optional: set a fixed (static) IP for this host -------------------------
#
# Prompted, never automatic: applying the wrong address, gateway or DNS on a
# box reached over SSH can cut off the very session used to fix it. Skipped
# outright when there's no terminal to confirm on, or when netplan isn't the
# thing managing networking here (anything but stock Ubuntu Server).
#
# Applied with `netplan try`, not `netplan apply` — try activates the new
# config, waits for an ENTER within the timeout to keep it, and otherwise
# reverts on its own. That auto-revert is the actual safety net for "typed
# the wrong gateway"; nothing here second-guesses the values beyond that.
FIXED_IP_FILE="/etc/netplan/90-homelab-fixed-ip.yaml"
if [ -t 0 ] && command -v netplan >/dev/null 2>&1; then
  if [ -f "$FIXED_IP_FILE" ]; then
    log "A fixed IP is already configured in $FIXED_IP_FILE — leaving it alone"
    echo "  (delete that file and re-run to reconfigure)"
  else
    echo
    printf 'Set a fixed (static) IP for this host now? [y/N]: '
    read -r SET_FIXED_IP_ANS
    if [ "${SET_FIXED_IP_ANS,,}" = "y" ] || [ "${SET_FIXED_IP_ANS,,}" = "yes" ]; then
      DEFAULT_IFACE="$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | head -n1)"
      DEFAULT_ADDR="$(ip -4 -o addr show dev "$DEFAULT_IFACE" 2>/dev/null | awk '{print $4}' | head -n1)"
      DEFAULT_GW="$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="via") print $(i+1)}' | head -n1)"
      DEFAULT_DNS="$(awk '/^nameserver/{printf "%s%s", sep, $2; sep=","}' /etc/resolv.conf 2>/dev/null)"
      DEFAULT_DNS="${DEFAULT_DNS:-1.1.1.1,8.8.8.8}"

      printf 'Network interface [%s]: ' "$DEFAULT_IFACE"; read -r x; FIXED_IFACE="${x:-$DEFAULT_IFACE}"
      printf 'Static IP with prefix, e.g. 192.168.1.50/24 [%s]: ' "$DEFAULT_ADDR"; read -r x; FIXED_ADDR="${x:-$DEFAULT_ADDR}"
      printf 'Gateway [%s]: ' "$DEFAULT_GW"; read -r x; FIXED_GW="${x:-$DEFAULT_GW}"
      printf 'DNS servers, comma-separated [%s]: ' "$DEFAULT_DNS"; read -r x; FIXED_DNS="${x:-$DEFAULT_DNS}"

      if [ -z "$FIXED_IFACE" ] || [ -z "$FIXED_ADDR" ] || [ -z "$FIXED_GW" ]; then
        echo "error: interface, IP and gateway are all required — skipping fixed-IP setup." >&2
      else
        FIXED_DNS_YAML="$(printf '%s' "$FIXED_DNS" | sed 's/,/, /g')"
        echo
        echo "About to apply, via 'netplan try' (auto-reverts if not confirmed):"
        echo "  interface: $FIXED_IFACE"
        echo "  address:   $FIXED_ADDR"
        echo "  gateway:   $FIXED_GW"
        echo "  dns:       $FIXED_DNS"
        printf 'Type YES to apply, anything else to skip: '
        read -r FIXED_IP_CONFIRM
        if [ "$FIXED_IP_CONFIRM" = "YES" ]; then
          cat > "$FIXED_IP_FILE" <<YAML
network:
  version: 2
  ethernets:
    ${FIXED_IFACE}:
      dhcp4: no
      addresses: [${FIXED_ADDR}]
      routes:
        - to: default
          via: ${FIXED_GW}
      nameservers:
        addresses: [${FIXED_DNS_YAML}]
YAML
          chmod 600 "$FIXED_IP_FILE"

          # cloud-init regenerates /etc/netplan/50-cloud-init.yaml from its own
          # DHCP defaults on every boot unless told not to — which would
          # silently fight this file on the next reboot. Only written once,
          # and only now that a fixed IP is actually being applied.
          if [ -d /etc/cloud/cloud.cfg.d ] && [ ! -f /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg ]; then
            printf 'network: {config: disabled}\n' > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
            log "Disabled cloud-init's network config (it would otherwise revert this on reboot)"
          fi

          log "Applying with 'netplan try' — press ENTER within 45s to keep it, or it reverts automatically"
          netplan generate
          if netplan try --timeout 45; then
            log "Fixed IP applied and confirmed: ${FIXED_ADDR}"
          else
            warn "netplan try reverted (not confirmed in time, or it failed) — $FIXED_IP_FILE was removed by netplan; re-run to try again"
            rm -f "$FIXED_IP_FILE"
          fi
        else
          log "Skipped — this host keeps its current network configuration"
        fi
      fi
    fi
  fi
elif [ -t 0 ]; then
  warn "netplan not found — this host isn't using Ubuntu's default network stack, so setting a fixed IP isn't automated here. Configure it by hand for your networking setup."
fi

# --- Optional: remove the sudo password prompt for the invoking user ---------
#
# Prompted, never automatic — full NOPASSWD sudo for TARGET_USER means any
# shell running as that user is root, no password asked. Safe to offer now
# that code-server's LAN port (the thing that made this an open-LAN-port-to
# -root path) requires its own login (plan.md §93) — but it is still a real
# privilege grant, so this asks for a typed confirmation every time, not a
# single y/N.
if [ "$TARGET_USER" != "root" ] && [ -t 0 ]; then
  SUDOERS_FILE="/etc/sudoers.d/90-${TARGET_USER}-nopasswd"
  if [ -f "$SUDOERS_FILE" ]; then
    log "Passwordless sudo is already set up for '${TARGET_USER}' ($SUDOERS_FILE)"
  else
    echo
    echo "Remove the sudo password prompt for '${TARGET_USER}'?"
    echo "This grants full passwordless sudo (NOPASSWD:ALL) — any shell"
    echo "running as '${TARGET_USER}' becomes root with no password asked."
    printf 'Type YES to proceed, anything else to skip: '
    read -r NOPASSWD_CONFIRM
    if [ "$NOPASSWD_CONFIRM" = "YES" ]; then
      TMP_SUDOERS="$(mktemp)"
      printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$TARGET_USER" > "$TMP_SUDOERS"
      if visudo -c -f "$TMP_SUDOERS" >/dev/null 2>&1; then
        install -m 0440 -o root -g root "$TMP_SUDOERS" "$SUDOERS_FILE"
        log "Passwordless sudo enabled for '${TARGET_USER}' ($SUDOERS_FILE)"
      else
        echo "error: generated sudoers snippet failed validation — not installed." >&2
      fi
      rm -f "$TMP_SUDOERS"
    else
      log "Skipped — '${TARGET_USER}' still needs a password for sudo"
    fi
  fi
fi
