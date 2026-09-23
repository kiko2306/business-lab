# Docker Compose implementation plan

## Problem and approach

Create a local-development Docker Compose stack for the Laravel 8 application.
The `fe` directory is the application's public document root, while `api`
contains the Laravel runtime and Composer dependencies, so they run together
in one PHP/Apache container. A MySQL 8.0 service provides the database.
phpMyAdmin provides browser-based database administration.
A dedicated cron service runs the schedules defined in the root `cron` file.

The stack starts with `docker compose up --build`. Both containers load
`api/.env` directly so existing database credentials are reused without copying
secrets into `compose.yaml`. Container-specific settings override `APP_URL`,
`DB_HOST`, and `DB_PORT`. The app uses port `8082` because ports `8080` and
`8081` are already occupied on the development host.

## Todos

### 1. Add the PHP/Apache development image

- Add `api/Dockerfile` based on PHP 7.4 Apache, compatible with `php: ^7.3`.
- Install Composer dependencies and the required PHP extensions.
- Enable Apache rewrite support and use `/var/www/fe` as the document root.
- Exclude secrets, local dependencies, logs, and caches from the image build.

### 2. Add the Compose stack

- Add `compose.yaml` with `app` and `db` services.
- Load `api/.env` directly in both services and map its database settings into
  MySQL during container startup.
- Override the application URL to `http://localhost:8082` and use `db:3306`
  for Laravel's database connection.
- Bind-mount `api` and `fe`, expose public storage, and persist Composer
  dependencies and MySQL data in named volumes.
- Wait for a healthy MySQL service and run migrations without seeders.
- Align Apache's UID/GID with the host so Laravel bind mounts remain writable.

### 3. Document and validate the workflow

- Document startup, shutdown, and clean-database commands in `README.MD`.
- Confirm both services are healthy and the login page and storage assets load.
- Confirm migrations complete and MySQL data persists across restarts.

### 4. Add phpMyAdmin

- Add a pinned phpMyAdmin service connected to the `db` service.
- Publish phpMyAdmin at `http://localhost:8083`.
- Wait for MySQL health before starting phpMyAdmin.
- Document login using `DB_USERNAME` and `DB_PASSWORD` from `api/.env`.

### 5. Add scheduled cron jobs

- Install Debian cron in the shared PHP image.
- Update the root `cron` file to use `/usr/local/bin/php` and
  `/var/www/api/artisan`.
- Add a dedicated `cron` Compose service that starts after the app is healthy.
- Run jobs as the host-aligned `www-data` user with container database
  networking and stream job output to Compose logs.
- Document how to inspect cron output.

### 6. Fix cron and queued mail execution

- Redirect cron output to a writable Laravel log and stream it to Compose logs.
- Log the timestamp and command name for every scheduled execution.
- Embed the configured email logo from its local storage path instead of
  passing an HTTP URL to SwiftMailer's file API.
- Run `checkin:send` and the queue worker to verify dispatch and delivery.

### 7. Fix bulk guest ingestion

- Accept either one guest object or an array of guests at `POST /api/guests`.
- Validate every guest code and always return JSON validation errors.
- Upsert the complete batch atomically and report the saved count.
- Keep the legacy `POST /api/guests-lst` route compatible with the same logic.
- Add focused feature coverage for bulk creation, updates, and validation.

## Implementation result

Completed. Plain `docker compose up` works, both containers are healthy, all 43
migrations are applied, `/login` returns HTTP 200, public storage assets are
served, and MySQL data persists across Compose restarts. phpMyAdmin is available
at `http://localhost:8083`. The cron schedules start automatically with the
Compose stack. Cron output is writable and visible in Compose logs, and email
logo attachments resolve from Laravel storage. A real scheduled tick executed
the queue worker and connection check, and a previously failed email completed
after retry. The current `checkin:send` run found four candidate reservations,
but all four lacked an associated guest, so no check-in emails were queued.
The guests API accepts the supplied bulk payload without redirecting to login.
