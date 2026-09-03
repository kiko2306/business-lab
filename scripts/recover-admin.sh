#!/usr/bin/env bash
# Emergency admin recovery for a locked-out dashboard.
#
#   ./start.sh recover list             # show the usernames that exist
#   ./start.sh recover reset-password   # set a new password for an existing user
#   ./start.sh recover create-admin     # add an admin when there is none
#
# Invoked by `./start.sh recover` (which forwards its arguments here) so the
# only command a human types is still `./start.sh`. The HTTP /api/recovery/*
# endpoints gate on a loopback source address the backend never sees from
# inside its container (plan.md §105), so this runs the reset *in* the backend
# container as the tool instead — no `docker exec` runbook step, no widened
# network gate.
#
# The new password is read here (hidden, with confirmation) and handed to the
# container through the environment, never on a command line, so it does not
# appear in `ps` or the shell history.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

sub="${1:-}"

usage() {
  cat <<'EOF'
Usage: ./start.sh recover <subcommand>

  list             show the usernames that exist
  reset-password   set a new password for an existing user
  create-admin     add an admin account when there is none

reset-password and create-admin prompt for the username (or take it as the
next argument) and for the new password (hidden, entered twice).
EOF
}

case "$sub" in
  list | reset-password | create-admin) ;;
  "" | -h | --help | help)
    usage
    exit 0
    ;;
  *)
    echo "recover: unknown subcommand '$sub'" >&2
    usage >&2
    exit 1
    ;;
esac

if ! docker compose version >/dev/null 2>&1; then
  echo "recover: 'docker compose' is not available on this host." >&2
  exit 1
fi

# Prefer exec into the already-running backend — it is quick and reuses the
# live environment. Fall back to a throwaway container (its entrypoint still
# wires up DATABASE_URL and the compose network) when the stack is down, which
# is exactly when someone may be trying to recover.
if docker compose ps --status running --services 2>/dev/null | grep -qx backend; then
  run_in_backend() { docker compose exec -T -u appuser "$@" backend node dist/scripts/recoverAdmin.js "$sub"; }
else
  echo "recover: backend container is not running — using a one-off container." >&2
  run_in_backend() { docker compose run --rm --no-deps -T "$@" backend node dist/scripts/recoverAdmin.js "$sub"; }
fi

if [ "$sub" = "list" ]; then
  run_in_backend
  exit $?
fi

# reset-password / create-admin
username="${2:-}"
if [ -z "$username" ]; then
  read -rp "Username: " username
fi

read -rsp "New password (8-128 chars): " password
echo
read -rsp "Confirm password: " password_confirm
echo
if [ "$password" != "$password_confirm" ]; then
  echo "recover: passwords do not match." >&2
  exit 1
fi

RECOVER_USERNAME="$username" RECOVER_PASSWORD="$password" \
  run_in_backend -e RECOVER_USERNAME -e RECOVER_PASSWORD
