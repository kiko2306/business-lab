#!/usr/bin/env bash
# Proves start.sh's EXPAND_VG_DISK block against real LVM.
#
# That block erases a disk and grows a mounted filesystem onto it — the kind of
# code that is either right or takes the machine's data with it, and the kind
# nobody wants to test by running it on the machine. So it is tested here
# against loopback disks: the same pvcreate / vgextend / lvextend / resize2fs
# path, the same refusals, on volume groups made for the occasion.
#
#   ./scripts/test-vg-expansion.sh
#
# Needs Docker, and runs a --privileged container. Loop devices and
# device-mapper are kernel-global, so this briefly creates loop devices and two
# throwaway volume groups (vg_target, vg_other) visible to the host, and
# releases them on the way out — including when a test fails. It never names a
# device it did not just allocate, and refuses to continue if losetup hands it
# anything that is not /dev/loopN.
#
# The block under test is extracted from start.sh by its boundary comment
# rather than by line number, so editing start.sh does not silently make this
# test exercise the wrong lines.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MARKER='# --- Optional: grow the volume group onto another disk'
{
  echo '#!/usr/bin/env bash'
  echo 'set -euo pipefail'
  printf 'log() { printf "==> %%s\\n" "$1"; }\n'
  printf 'warn() { printf "warning: %%s\\n" "$1" >&2; }\n'
  # From the marker to the first unindented "fi", which is the end of the
  # block's top-level if. Every fi inside it is indented.
  awk -v m="$MARKER" 'index($0, m) == 1 { f = 1 } f { print } f && /^fi$/ { exit }' start.sh
} > "$WORK/expand-block.sh"

if ! grep -q 'EXPAND_VG_DISK' "$WORK/expand-block.sh"; then
  echo "error: could not find the expansion block in start.sh — has the marker comment changed?" >&2
  exit 1
fi
bash -n "$WORK/expand-block.sh"

cat > "$WORK/setup.sh" <<'SETUPEOF'
# A container has no udev, so LVM must make its own device nodes and not wait
# for events that never arrive — otherwise lvcreate fails the fixture with
# "not found: device not cleared" and every assertion below measures the
# container's overlay filesystem instead.
export DM_DISABLE_UDEV=1
mkdir -p /etc/lvm
cat > /etc/lvm/lvm.conf <<'LVMCONF'
activation { udev_rules = 0 udev_sync = 0 }
devices { obtain_device_list_from_udev = 0 }
LVMCONF

mknod /dev/loop-control c 10 237 2>/dev/null || true
mkdir -p /dev/mapper && mknod /dev/mapper/control c 10 236 2>/dev/null || true
for i in $(seq 0 24); do [ -e "/dev/loop$i" ] || mknod "/dev/loop$i" b 7 "$i"; done

DISKS=()
cleanup() {
  set +e
  umount /mnt/target /mnt/busy /mnt/plain 2>/dev/null
  vgchange -an vg_target vg_other >/dev/null 2>&1
  vgremove -f vg_target vg_other >/dev/null 2>&1
  for d in "${DISKS[@]}"; do
    pvremove -ff -y "$d" >/dev/null 2>&1
    wipefs -a "$d" >/dev/null 2>&1
    losetup -d "$d" >/dev/null 2>&1
  done
  echo "cleanup: released ${DISKS[*]:-none}"
}
trap cleanup EXIT

# Sets LAST_DISK rather than echoing it: a $(...) call site would run this in a
# subshell and the cleanup list would not survive, which is how an earlier
# version of this harness left three loop devices attached to the host.
alloc_disk() {
  local img="$1"
  truncate -s 1G "$img"
  LAST_DISK="$(losetup -f --show "$img")" || { echo "losetup failed for $img"; exit 1; }
  case "$LAST_DISK" in
    /dev/loop[0-9]*) ;;
    *) echo "REFUSING: losetup returned '$LAST_DISK', which is not a loop device"; exit 1 ;;
  esac
  DISKS+=("$LAST_DISK")
}
SETUPEOF

cat > "$WORK/run-tests.sh" <<'TESTEOF'
#!/usr/bin/env bash
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq lvm2 e2fsprogs util-linux >/dev/null 2>&1

source /work/setup.sh

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
run() { EXPAND_VG_ASSUME_YES=1 bash /work/expand-block.sh 2>&1; }

alloc_disk /tmp/d0.img; D_TARGET="$LAST_DISK"
alloc_disk /tmp/d1.img; D_NEW="$LAST_DISK"
alloc_disk /tmp/d2.img; D_OTHER="$LAST_DISK"
echo "allocated: target=$D_TARGET new=$D_NEW other=$D_OTHER"

# The stand-in for the real host: a volume group on one disk, ext4, mounted.
pvcreate -y "$D_TARGET" >/dev/null
vgcreate vg_target "$D_TARGET" >/dev/null
lvcreate -y -l 100%FREE -n lv_data vg_target >/dev/null
mkfs.ext4 -q /dev/vg_target/lv_data
mkdir -p /mnt/target && mount /dev/vg_target/lv_data /mnt/target
echo "hello from before the expansion" > /mnt/target/canary.txt

# A disk owned by a different volume group, for the refusal test.
pvcreate -y "$D_OTHER" >/dev/null
vgcreate vg_other "$D_OTHER" >/dev/null

# If the fixture did not mount, every size assertion below would silently
# measure the container's root filesystem and "pass".
findmnt -no SOURCE /mnt/target | grep -q lv_data || { echo "SETUP FAILED: /mnt/target is not the test LV"; exit 1; }
SIZE_BEFORE=$(df -BM --output=size /mnt/target | tail -1 | tr -dc '0-9')
echo "== start: /mnt/target is ${SIZE_BEFORE}M"

echo; echo "TEST 1: refuses something that is not a block device"
out=$(EXPAND_VG_DISK=/tmp/nope EXPAND_VG_TARGET=/mnt/target run); rc=$?
{ [ $rc -ne 0 ] && grep -q "not a block device" <<<"$out"; } && ok "refused (rc=$rc)" || bad "rc=$rc | $out"

echo; echo "TEST 2: refuses a disk belonging to another volume group"
out=$(EXPAND_VG_DISK="$D_OTHER" EXPAND_VG_TARGET=/mnt/target run); rc=$?
{ [ $rc -ne 0 ] && grep -q "vg_other" <<<"$out"; } && ok "refused (rc=$rc)" || bad "rc=$rc | $out"

echo; echo "TEST 3: refuses a disk with a mounted filesystem"
mkfs.ext4 -q "$D_NEW"; mkdir -p /mnt/busy; mount "$D_NEW" /mnt/busy
out=$(EXPAND_VG_DISK="$D_NEW" EXPAND_VG_TARGET=/mnt/target run); rc=$?
{ [ $rc -ne 0 ] && grep -q "mounted filesystems" <<<"$out"; } && ok "refused (rc=$rc)" || bad "rc=$rc | $out"
umount /mnt/busy

echo; echo "TEST 4: refuses a target that is not on LVM"
mkdir -p /mnt/plain; mount "$D_NEW" /mnt/plain
out=$(EXPAND_VG_DISK="$D_NEW" EXPAND_VG_TARGET=/mnt/plain run); rc=$?
{ [ $rc -ne 0 ] && grep -q "not an LVM logical volume" <<<"$out"; } && ok "refused (rc=$rc)" || bad "rc=$rc | $out"
umount /mnt/plain

echo; echo "TEST 5: refuses with no terminal when confirmation is not waived"
out=$(EXPAND_VG_DISK="$D_NEW" EXPAND_VG_TARGET=/mnt/target bash /work/expand-block.sh </dev/null 2>&1); rc=$?
{ [ $rc -ne 0 ] && grep -q "no terminal to confirm" <<<"$out"; } && ok "refused (rc=$rc)" || bad "rc=$rc | $out"

echo; echo "TEST 6: THE REAL THING — erases the disk and grows the mounted filesystem"
out=$(EXPAND_VG_DISK="$D_NEW" EXPAND_VG_TARGET=/mnt/target run); rc=$?
sed 's/^/     | /' <<<"$out"
SIZE_AFTER=$(df -BM --output=size /mnt/target | tail -1 | tr -dc '0-9')
[ $rc -eq 0 ] && ok "exit 0" || bad "exit $rc"
[ "$SIZE_AFTER" -gt "$SIZE_BEFORE" ] && ok "grew ${SIZE_BEFORE}M -> ${SIZE_AFTER}M, online" || bad "did not grow (${SIZE_BEFORE}M -> ${SIZE_AFTER}M)"
[ "$(cat /mnt/target/canary.txt)" = "hello from before the expansion" ] && ok "existing data intact" || bad "canary lost"
pvs --noheadings -o pv_name,vg_name | grep -q "$(basename "$D_NEW").*vg_target" && ok "disk is now a PV in vg_target" || bad "disk not in vg_target"
grep -q "no redundancy" <<<"$out" && ok "warned about the single failure domain" || bad "no redundancy warning"

echo; echo "TEST 7: idempotent — a second run changes nothing"
out=$(EXPAND_VG_DISK="$D_NEW" EXPAND_VG_TARGET=/mnt/target run); rc=$?
SIZE_AGAIN=$(df -BM --output=size /mnt/target | tail -1 | tr -dc '0-9')
{ [ $rc -eq 0 ] && grep -q "already part of" <<<"$out"; } && ok "recognised the disk (rc=$rc)" || bad "rc=$rc | $out"
grep -q "no free extents" <<<"$out" && ok "reported nothing left to take" || bad "expected 'no free extents' | $out"
[ "$SIZE_AGAIN" = "$SIZE_AFTER" ] && ok "size unchanged at ${SIZE_AGAIN}M" || bad "size changed"
[ "$(cat /mnt/target/canary.txt)" = "hello from before the expansion" ] && ok "data still intact" || bad "canary lost"

echo; echo "================================"
echo "PASSED: $PASS   FAILED: $FAIL"
[ "$FAIL" -eq 0 ]
TESTEOF

echo "==> Running the expansion tests in a privileged container"
docker run --rm --privileged -v "$WORK":/work -w /work ubuntu:24.04 bash /work/run-tests.sh
