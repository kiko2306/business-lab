#!/bin/sh
set -eu

cd /var/www/api

app_uid="${APP_UID:-1000}"
app_gid="${APP_GID:-1000}"

if [ "$(id -g www-data)" != "$app_gid" ]; then
    groupmod --gid "$app_gid" www-data
fi

if [ "$(id -u www-data)" != "$app_uid" ]; then
    usermod --uid "$app_uid" --gid "$app_gid" www-data
fi

mkdir -p \
    bootstrap/cache \
    storage/framework/cache/data \
    storage/framework/sessions \
    storage/framework/views \
    storage/logs

gosu "${app_uid}:${app_gid}" php artisan package:discover --ansi
gosu "${app_uid}:${app_gid}" php artisan view:clear
gosu "${app_uid}:${app_gid}" php artisan migrate --force

exec apache2-foreground
