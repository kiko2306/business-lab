# Hotel legacy data import

Runs once per client, at cutover, from an operator's own machine (or
anywhere network-reachable from both databases — it doesn't run inside the
dashboard stack, and isn't a managed app). Pulls check-in history and
feedback responses out of the legacy Laravel/MySQL database and into
hotel-core. Everything else (units, guests' ordinary contact details,
reservations) re-syncs fresh from Wintouch through the property agent
instead (plan.md §629, §658).

## Before running it

The agent must already have completed its first full sync — this only
**updates** guests and reservations hotel-core already knows about; it
never creates one. Run it after that first sync, not before.

If a client wants their old feedback answers preserved, make sure
hotel-admin's feedback questions (Settings → feedback, or wherever pulse's
question editor lives) already match the legacy wording **exactly** —
matching is by question text, since the legacy's quiz structure has no id
in common with hotel-core's (plan.md §657).

## Running it

```bash
cd apps/hotel/import
npm ci && npm run build
MYSQL_URL="mysql://user:pass@legacy-db-host/legacy_db" \
DATABASE_URL="postgres://hotel:...@hotel-core-db-host/hotel" \
node dist/index.js
```

Prints a JSON summary: how many guests and reservations were updated, how
many feedback responses imported, and — if any — which legacy question
texts had no match in hotel-core, so they can be fixed and the import
re-run. Re-running is always safe: every write is an idempotent `UPDATE` or
an `ON CONFLICT DO NOTHING` insert, so nothing is imported twice.

## What it does not do

- Does not touch units, guests' contact details, or reservation booking
  details — all of that belongs to the agent's ongoing Wintouch sync, and
  overwriting it with a possibly-stale legacy copy would be a regression,
  not a migration.
- Does not send a "re-send" email of its own. A guest who hadn't finished
  check-in/feedback under the legacy system is picked up automatically by
  hotel-core's existing scheduler on its next tick, with a fresh, working
  link (plan.md §657) — this import only has to get the *completion* flags
  right so that guest isn't also asked to redo something already done.
