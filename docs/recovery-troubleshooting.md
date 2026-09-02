# Recovery and Troubleshooting

## Recovery procedures

> **Known gap.** These endpoints only accept requests whose `req.ip` is
> `127.0.0.1`/`::1`. The backend runs in a container, so a `curl` from the host
> arrives from the Docker bridge gateway and is refused — the endpoints below
> are not reachable from a headless host as written. The only current path is
> `docker compose exec backend wget …` from inside the container, which the
> project's no-console principle rules out of a runbook. A proper host-side
> mechanism is an open item (see the README TODO). Until then, resetting a
> locked-out admin means editing the `users` table in Postgres directly.

### Enable recovery mode (localhost only)
`POST /api/recovery/enable` with:
```json
{"confirm":"ENABLE_RECOVERY_MODE"}
```

### Reset admin password
`POST /api/recovery/reset-admin-password`
```json
{"username":"admin","password":"new-password"}
```

### Disable recovery mode
`POST /api/recovery/disable`

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
