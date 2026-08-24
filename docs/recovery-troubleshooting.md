# Recovery and Troubleshooting

## Recovery procedures

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
