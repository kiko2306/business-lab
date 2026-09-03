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

- Create backup: `POST /api/backups/create`
- Restore backup: `POST /api/backups/restore`
- Download backup: `GET /api/backups/download/:fileName`

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

## Troubleshooting

- API health: `GET /health`
- Deep health: `GET /api/health`
- Check container logs: `docker compose logs -f backend frontend database`
- Validate runtime with smoke tests: `./scripts/smoke-tests.sh`
