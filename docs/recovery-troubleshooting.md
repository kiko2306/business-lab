# Recovery and Troubleshooting

## Locked out of the dashboard

Run this on the host — it is the one exception to "the only command is
`./start.sh`", and it is still `./start.sh`:

```bash
./start.sh recover list             # which usernames exist
./start.sh recover reset-password   # set a new password for one of them
./start.sh recover create-admin     # only if there is no account at all
./start.sh recover disable-2fa      # clear a user's TOTP second factor
```

`reset-password` / `create-admin` ask for the username (or take it as the next
word: `./start.sh recover reset-password alice`) and then for the new password
twice, hidden. The reset also revokes that account's existing sessions, so a
stolen token can't outlive it. `disable-2fa` takes just the username and turns
off two-factor for someone who has lost their authenticator (their password
still works). Every run is written to `audit_logs` (`recovery_reset_password`,
`recovery_create_admin`, `recovery_disable_2fa`).

Under the hood `start.sh` runs the reset *inside* the backend container, as the
tool — there is no `docker exec` for you to type, and nothing new is exposed on
the network. It works whether or not the stack is currently up (it falls back
to a one-off container). See plan.md §105/§126.

### The HTTP `/api/recovery/*` endpoints

`POST /api/recovery/{enable,reset-admin-password,disable}` still exist, but they
gate on `req.ip` being loopback — which, with the backend in a container, only
a request from *inside* that container satisfies. They are therefore usable
only on a bare-metal (non-container) deployment. On the normal containerised
install, use `./start.sh recover` above.

## Backup/restore

There are **two** backups, for different jobs:

| | The scheduled off-site backup | Per-app snapshots |
|---|---|---|
| What | The whole `apps/` tree, one encrypted, versioned archive at your chosen destination (disk / SMB / NFS / Drive / FTP) via Duplicati | One `.tar.gz` per app, kept locally in `backups/apps/<app>/` (the `backups-data` volume) |
| For | Disaster recovery — the box is gone, or you need last week's state | A quick rollback point *before* you reconfigure or update an app |
| Where | Dashboard → **Backups** page (schedule, retention, "Back up now", destination) | Each app's card → **Settings → Backups** (Back up now / Restore / Download / Delete) |
| Retention | Configurable (`7D:1D,4W:1W,12M:1M` inside Duplicati) | Last 10 per app |

### Management-stack backup (the dashboard's own database)

- Create: `POST /api/backups/create` · Restore: `POST /api/backups/restore` ·
  Download: `GET /api/backups/download/:fileName`
- Covers the dashboard's Postgres plus a slice of its settings/users. Nothing
  to do with the managed apps.

### Per-app snapshots

- List: `GET /api/services/:name/backups` · Create: `POST
  /api/services/:name/backup` · Download: `GET
  /api/services/:name/backups/:file` · Delete: `DELETE
  /api/services/:name/backups/:file` · Restore: `POST
  /api/services/:name/backup/restore` `{ "file": "…" }`
- **Create** dumps that app's database(s) (`pg_dump --clean --if-exists` /
  `mariadb-dump` / `sqlite3 .backup`) into `apps/<app>/data/_dump/`, then tars
  `apps/<app>/data` — excluding the live DB directory (`data/db`) and SQLite
  side-files, which restore torn. A `manifest.json` sidecar records the
  timestamp, dashboard version, engine and dump results.
- **Restore** stops the app, replaces its `data/` from the archive (the live
  `data/db` is kept), replays the SQL dump into a freshly-started DB container,
  copies each `_dump/*.sqlite` snapshot over its live file, then starts the app
  again. A failed DB replay is a warning, not a failure — the app still comes
  back up. Anything changed since the snapshot is lost.
- Proven end to end on the live stack (`plan.md` §187–§188): n8n (Postgres)
  and Vaultwarden (SQLite) — data and files rolled back, apps healthy after.

### Restoring one app's database by hand

If you need to replay a dump without the dashboard (checking it first, or the
backend is down), the dump under `apps/<app>/data/_dump/<app>.sql` is plain
SQL:

1. Stop the app; leave its DB container running.
2. Replay:

   ```bash
   # Postgres — the dump carries DROP ... IF EXISTS, so it replaces objects in place
   docker exec -i -e PGPASSWORD=<pw> <app>-db-1 \
     psql -U <user> -d <db> < apps/<app>/data/_dump/<app>.sql

   # MySQL / MariaDB
   docker exec -i -e MYSQL_PWD=<pw> <app>-db-1 \
     mariadb -u <user> <db> < apps/<app>/data/_dump/<app>.sql
   ```

   Credentials are in `apps/<app>/.env` (or `docker inspect` the DB container).
3. Embedded SQLite instead: `sqlite3 <live.db> ".restore
   'apps/<app>/data/_dump/<name>.sqlite'"` while the app is stopped.
4. Start the app.

Replaying into a scratch database first (a throwaway `docker run` of the same
image) is the safe way to check a dump before touching the live one. The
Postgres, MySQL and MariaDB dump→replay paths are verified end to end against
the live stack (`plan.md` §183).

### Apps without a consistent database snapshot

The scheduled app-data backup dumps every SQL database (`pg_dump` /
`mariadb-dump`) and snapshots every SQLite file (`sqlite3 .backup`) before
Duplicati copies `apps/`. Two apps embed a database with no equivalent
online-dump path, so their live DB file is copied as-is:

| App | Engine | File |
|---|---|---|
| File Browser | BoltDB | `apps/file-browser/data/database/filebrowser.db` |
| Stirling-PDF | H2 | `apps/stirling-pdf/data/configs/stirling-pdf-DB-*.mv.db` |

`findSqliteFiles` refuses both by file header (they are not SQLite despite the
`.db` name), so they are never *mis*-snapshotted as SQLite — they are simply
not made consistent. A copy taken while the app is writing can restore
truncated or corrupt.

**This is an accepted risk**, because what each database holds is small and
easily rebuilt:

- **File Browser** — users, share links and UI settings only. The files it
  serves live on separate mounts (`apps/file-browser/data/files/` and the host
  home directory) and back up normally, unaffected by the DB. If the DB
  restores bad: delete `filebrowser.db` and restart; the image recreates it
  with the default `admin` / `admin` login (change it), then re-add any users
  and shares.
- **Stirling-PDF** — nothing, at the default `SECURITY_ENABLELOGIN=false`: it
  is stateless PDF processing. Its real configuration (`settings.yml`,
  `custom_settings.yml`, pipelines, custom files, OCR language packs) are plain
  files and back up consistently. With login enabled the H2 DB adds user
  accounts and API keys — recreate them from the UI after a bad restore. The
  `.mv.db` filename carries the Stirling version, so a restore across an app
  upgrade would be stale regardless.

**If you need a clean copy anyway:** stop the app from the dashboard, let one
scheduled backup (or "Back up now") complete, then start it again — the file is
quiescent while Duplicati reads it.

### OnlyOffice keeps no persistent state

The community `onlyoffice/documentserver` image (9.x) has **no database and no
message queue**. Upstream removed the bundled PostgreSQL/RabbitMQ after 8.0,
and the image only wires up an *external* one under a paid edition
(`PRODUCT_EDITION` set) — it hard-codes `DB_AVAILABLE=false` otherwise and
ships no `psql` client, so pointing `DB_HOST`/`AMQP_URI` at sidecar containers
does nothing (verified — `plan.md` §175). There is therefore nothing for the
app-data backup to dump, and `apps/onlyoffice/data/db` is empty.

**This is an accepted limitation**, in the same bucket as the two apps above:

- The documents themselves are stored in **Nextcloud**, which has a proper
  Postgres dump. OnlyOffice only fetches a file, holds the live editing
  session in memory, and writes the result back to Nextcloud via its callback.
- What the missing database *would* hold is transient: active co-editing
  sessions, the change cache, the callback command queue. A restart of the
  document-server container drops any in-progress co-editing session (the
  shutdown hook forces a save to Nextcloud first); single-user editing and
  save-back are unaffected, and no saved document is at risk.
- Nothing to restore, nothing to rebuild. If co-editing misbehaves, restart
  the `onlyoffice` service from the dashboard.

Revisit only if the Nextcloud↔OnlyOffice integration shows co-editing loss
actually biting in practice.

## Troubleshooting

- API health: `GET /health`
- Deep health: `GET /api/health`
- Check container logs: `docker compose logs -f backend frontend database`
- Validate runtime with smoke tests: `./scripts/smoke-tests.sh`
