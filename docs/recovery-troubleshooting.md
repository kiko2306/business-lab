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

## Troubleshooting

- API health: `GET /health`
- Deep health: `GET /api/health`
- Check container logs: `docker compose logs -f backend frontend database`
- Validate runtime with smoke tests: `./scripts/smoke-tests.sh`
