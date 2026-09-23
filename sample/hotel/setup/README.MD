# Hotel Utils

## Local development with Docker

The application runs at <http://localhost:8082>, with MySQL exposed on
`localhost:3306`. Docker Compose reads the existing database settings from
`api/.env`.

phpMyAdmin runs at <http://localhost:8083>. Sign in with the `DB_USERNAME` and
`DB_PASSWORD` values from `api/.env`; the server is already configured as
`db`.

Start the application:

```sh
docker compose up --build
```

After changing Laravel environment variables in `api/.env`, recreate the
application services so Docker reloads the environment, then clear Laravel's
cached configuration and restart the queue workers:

```sh
docker compose up -d --force-recreate app cron
docker compose exec app php artisan config:clear
docker compose exec app php artisan queue:restart
```

Stop the application while preserving the database:

```sh
docker compose down
```

Stop the application and delete the local database:

```sh
docker compose down --volumes
```

Laravel migrations run automatically whenever the application container
starts. Seeders are not run.

The `cron` service starts automatically and installs the schedules from the
root `cron` file. Its PHP and Artisan paths target the application container.
Each execution and its output are timestamped. View them with:

```sh
docker compose logs -f cron
```

## Setup MSSQL database with fake emails for testing

UPDATE wgcterceiros
SET email = LEFT(
    LOWER(
        REPLACE(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            TRANSLATE(TRIM(nome), 
                                'áéíóúçãõâêîôûàèìòùäëïöüÁÉÍÓÚÇÃÕÂÊÎÔÛÀÈÌÒÙÄËÏÖÜ', 
                                'aeioucaoaeiouaeiouaeiouAEIOUCAOAEIOUAEIOUAEIOU'),
                            ' ', ''),    -- 1. Removes spaces
                        '''', ''),       -- 2. Removes standard single quotes
                    '´', ''),            -- 3. Removes the tick mark (´)
                '&', ''),                -- 4. Removes ampersands (&)
            '-', '')                     -- 5. Removes hyphens (-)
    ), 
35) + '@fakedomain.com'
WHERE nome IS NOT NULL AND TRIM(nome) != '';

## TODO

    - after setup delete live folders in portoinf.com hotelutilapp, hotel.portoinf.com, see database to delete

## Instance scripts

This repository includes two helper scripts at the root:

- `deploy-new-instance.sh`: create a new client instance one level above this folder.
- `update-clients.sh`: sync setup changes from this folder to existing client instances.

### 1) Create a new client instance

Run:

```sh
./deploy-new-instance.sh
```

This now creates the instance and starts containers automatically.

If you only want to create files and skip container startup:

```sh
./deploy-new-instance.sh --no-start
```

Create and start in one step:

```sh
./deploy-new-instance.sh
```

Create + auto-provision Cloudflare (requires env vars):

```sh
export CF_API_TOKEN="..."
export CF_ACCOUNT_ID="..."
export CF_ZONE_ID="..."
export BASE_DOMAIN="example.com"
./deploy-new-instance.sh
```

Cloudflare token settings required:

- Token type: API Token
- Account permissions:
    - Cloudflare Tunnel: Edit
    - Cloudflare Tunnel: Read
- Zone permissions:
    - DNS: Edit
    - Zone: Read
- Account resources:
    - Include the account used by `CF_ACCOUNT_ID`
- Zone resources:
    - Include the zone used by `CF_ZONE_ID` (your `BASE_DOMAIN` zone)

If these permissions are missing, tunnel creation or DNS updates will fail.

Or keep Cloudflare credentials in a local file (recommended):

```sh
cp .cloudflare.env.example .cloudflare.env
# edit .cloudflare.env with real values
./deploy-new-instance.sh
```

What it does:

- Prompts for the client name.
- Creates `../<client-name>`.
- Copies required project files.
- Sets unique Docker compose project/image names.
- Assigns the first available sequential host ports starting at `1100`.
- Creates and populates `api/.env` with client values.
- If Cloudflare env vars are set, it also configures tunnel ingress and DNS records.
- If .cloudflare.env exists, values are auto-loaded for Cloudflare provisioning.
- Runs `php artisan storage:link --force` inside the app container after startup.

Default Cloudflare hostnames per client:

- App: `whotutils-<client-name>.<BASE_DOMAIN>`
- phpMyAdmin: `phpmyadmin-<client-name>.<BASE_DOMAIN>`
- Mailpit: `mail-<client-name>.<BASE_DOMAIN>`

After creating a new instance, start it:

```sh
cd ../<client-name>
docker compose up -d --build
```

Note: the script already runs this automatically unless you pass `--no-start`.
If you use `--no-start`, run storage link after starting:

```sh
cd ../<client-name>
docker compose exec -T app php artisan storage:link --force
```

### 2) Update existing client instances

Dry-run all clients first (recommended):

```sh
./update-clients.sh --all --dry-run
```

Update one client:

```sh
./update-clients.sh --client <client-name>
```

Update all clients:

```sh
./update-clients.sh --all
```

After syncing, the script rebuilds containers automatically.

If you only want to sync files and skip container rebuild:

```sh
./update-clients.sh --all --no-rebuild
```

Useful flags:

- `--dry-run`: preview changes only.
- `--delete`: remove files in clients that no longer exist in setup.
- `--include-compose`: also sync `compose.yaml` and `how-to-cloudflre-access.md`.
- `--no-rebuild`: sync files without running `docker compose up -d --build`.

By default, `update-clients.sh` preserves client-specific files:

- `api/.env`
- `compose.yaml`
- `how-to-cloudflre-access.md`