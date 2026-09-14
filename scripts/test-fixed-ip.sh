#!/usr/bin/env bash
# Proves setup_server.sh's unattended fixed-IP path (SETUP_FIXED_IP_*,
# README TODO / §422 follow-up) without ever touching a real netplan config
# or a real network interface.
#
# Runs in an unprivileged container: a fake `netplan` binary stands in for
# the real one (it only needs to answer `generate`; if the unattended path
# ever calls `try` — the interactive-only, live-applying command — the stub
# fails loudly, which is exactly the mistake this exists to catch), and
# FIXED_IP_FILE is redirected into the container's own /tmp so nothing here
# can ever write to a real /etc/netplan or /etc/cloud, containerized or not.
#
#   ./scripts/test-fixed-ip.sh
#
# The block under test is extracted from setup_server.sh by its boundary
# comment rather than by line number, so editing that file does not silently
# make this test exercise the wrong lines.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

MARKER='# --- Optional: set a fixed (static) IP for this host'
{
  echo '#!/usr/bin/env bash'
  echo 'set -uo pipefail'
  printf 'log() { printf "==> %%s\\n" "$1"; }\n'
  printf 'warn() { printf "warning: %%s\\n" "$1" >&2; }\n'
  # From the marker to the first unindented "fi", which is the end of the
  # block's top-level if. Every fi inside it is indented.
  awk -v m="$MARKER" 'index($0, m) == 1 { f = 1 } f { print } f && /^fi$/ { exit }' setup_server.sh \
    | sed 's#/etc/netplan/90-homelab-fixed-ip\.yaml#/work/netplan/90-homelab-fixed-ip.yaml#'
} > "$WORK/fixed-ip-block.sh"

if ! grep -q 'SETUP_FIXED_IP_IFACE' "$WORK/fixed-ip-block.sh"; then
  echo "error: could not find the unattended fixed-IP branch in setup_server.sh — has the marker comment changed?" >&2
  exit 1
fi
bash -n "$WORK/fixed-ip-block.sh"

mkdir -p "$WORK/netplan" "$WORK/bin"

# Fails loudly on anything but `generate` — the unattended path must never
# reach for `try` (that's the interactive-only, live-applying command; the
# whole point of the unattended path is to write-and-wait-for-reboot instead).
cat > "$WORK/bin/netplan" <<'NETPLAN'
#!/usr/bin/env bash
case "${1:-}" in
  generate)
    [ -f /tmp/netplan-generate-should-fail ] && exit 1
    exit 0
    ;;
  *)
    echo "TEST HARNESS: netplan called with unexpected subcommand: $*" >&2
    exit 99
    ;;
esac
NETPLAN
chmod +x "$WORK/bin/netplan"

cat > "$WORK/run-tests.sh" <<'TESTEOF'
#!/usr/bin/env bash
set -uo pipefail
export PATH="/work/bin:$PATH"
FIXED_IP_FILE=/work/netplan/90-homelab-fixed-ip.yaml

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
run() { bash /work/fixed-ip-block.sh </dev/null 2>&1; }
reset_state() { rm -f "$FIXED_IP_FILE" /tmp/netplan-generate-should-fail; }

echo "TEST 1: no SETUP_FIXED_IP_* at all — skipped entirely, no file, no output"
reset_state
unset SETUP_FIXED_IP_IFACE SETUP_FIXED_IP_ADDR SETUP_FIXED_IP_GATEWAY SETUP_FIXED_IP_DNS
out=$(run); rc=$?
{ [ $rc -eq 0 ] && [ -z "$out" ] && [ ! -f "$FIXED_IP_FILE" ]; } && ok "silent no-op" || bad "rc=$rc out='$out' file exists=$([ -f "$FIXED_IP_FILE" ] && echo yes || echo no)"

echo; echo "TEST 2: all four values set, netplan generate succeeds — file written, correct content, try never called"
reset_state
out=$(SETUP_FIXED_IP_IFACE=eth0 SETUP_FIXED_IP_ADDR=192.168.1.50/24 SETUP_FIXED_IP_GATEWAY=192.168.1.1 SETUP_FIXED_IP_DNS=1.1.1.1,8.8.8.8 run); rc=$?
sed 's/^/     | /' <<<"$out"
{ [ $rc -eq 0 ] && [ -f "$FIXED_IP_FILE" ]; } && ok "exit 0, file exists" || bad "rc=$rc | $out"
grep -q 'addresses: \[192.168.1.50/24\]' "$FIXED_IP_FILE" 2>/dev/null && ok "address written" || bad "address missing: $(cat "$FIXED_IP_FILE" 2>/dev/null)"
grep -q 'via: 192.168.1.1' "$FIXED_IP_FILE" 2>/dev/null && ok "gateway written" || bad "gateway missing"
grep -q 'addresses: \[1.1.1.1, 8.8.8.8\]' "$FIXED_IP_FILE" 2>/dev/null && ok "DNS list written, comma-spaced" || bad "DNS missing"
grep -qi 'not applied live' <<<"$out" && ok "said it did not apply live" || bad "missing 'not applied live' in output: $out"

echo; echo "TEST 3: missing one of the four values — error, nothing written"
reset_state
out=$(SETUP_FIXED_IP_IFACE=eth0 SETUP_FIXED_IP_ADDR=192.168.1.50/24 SETUP_FIXED_IP_GATEWAY=192.168.1.1 run); rc=$?
{ [ $rc -eq 0 ] && grep -qi 'must all be set together' <<<"$out" && [ ! -f "$FIXED_IP_FILE" ]; } && ok "refused, no file" || bad "rc=$rc file exists=$([ -f "$FIXED_IP_FILE" ] && echo yes || echo no) | $out"

echo; echo "TEST 4: netplan generate rejects the config — error, file cleaned up"
reset_state
touch /tmp/netplan-generate-should-fail
out=$(SETUP_FIXED_IP_IFACE=eth0 SETUP_FIXED_IP_ADDR=bad SETUP_FIXED_IP_GATEWAY=192.168.1.1 SETUP_FIXED_IP_DNS=1.1.1.1 run); rc=$?
rm -f /tmp/netplan-generate-should-fail
{ [ $rc -eq 0 ] && grep -qi 'rejected the generated config' <<<"$out" && [ ! -f "$FIXED_IP_FILE" ]; } && ok "reported, cleaned up" || bad "rc=$rc file exists=$([ -f "$FIXED_IP_FILE" ] && echo yes || echo no) | $out"

echo; echo "TEST 5: file already exists — left alone, SETUP_FIXED_IP_* ignored"
reset_state
mkdir -p "$(dirname "$FIXED_IP_FILE")"
printf 'sentinel: pre-existing config\n' > "$FIXED_IP_FILE"
out=$(SETUP_FIXED_IP_IFACE=eth0 SETUP_FIXED_IP_ADDR=192.168.1.50/24 SETUP_FIXED_IP_GATEWAY=192.168.1.1 SETUP_FIXED_IP_DNS=1.1.1.1 run); rc=$?
{ [ $rc -eq 0 ] && grep -qi 'already configured' <<<"$out" && grep -q 'sentinel: pre-existing config' "$FIXED_IP_FILE"; } && ok "left the existing file untouched" || bad "rc=$rc | $out | $(cat "$FIXED_IP_FILE" 2>/dev/null)"

echo; echo "================================"
echo "PASSED: $PASS   FAILED: $FAIL"
[ "$FAIL" -eq 0 ]
TESTEOF

echo "==> Running the fixed-IP tests in a container"
docker run --rm -v "$WORK":/work -w /work ubuntu:24.04 bash /work/run-tests.sh
