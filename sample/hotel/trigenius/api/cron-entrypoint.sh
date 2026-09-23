#!/bin/sh
set -eu

app_uid="${APP_UID:-1000}"
app_gid="${APP_GID:-1000}"
cron_log="/var/www/api/storage/logs/cron.log"

if [ "$(id -g www-data)" != "$app_gid" ]; then
    groupmod --gid "$app_gid" www-data
fi

if [ "$(id -u www-data)" != "$app_uid" ]; then
    usermod --uid "$app_uid" --gid "$app_gid" www-data
fi

touch "$cron_log"
chown "$app_uid:$app_gid" "$cron_log"

mkdir -p \
    /var/www/api/bootstrap/cache \
    /var/www/api/storage/framework/cache/data \
    /var/www/api/storage/framework/sessions \
    /var/www/api/storage/framework/views \
    /var/www/api/storage/logs
chown -R "$app_uid:$app_gid" /var/www/api/bootstrap/cache /var/www/api/storage
find /var/www/api/bootstrap/cache /var/www/api/storage -type d -exec chmod 775 {} \;
find /var/www/api/bootstrap/cache /var/www/api/storage -type f -exec chmod 664 {} \;

{
    printf '%s\n' \
        'SHELL=/bin/sh' \
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        "APP_URL=${APP_URL:-http://localhost:8082}" \
        "DB_HOST=${DB_HOST:-db}" \
        "DB_PORT=${DB_PORT:-3306}"

    awk '
        /^[[:space:]]*($|#)/ { next }
        {
            printf "%s %s %s %s %s www-data", $1, $2, $3, $4, $5
            printf " echo \"[cron] $(date -Is) running:"
            for (i = 6; i <= NF; i++) {
                printf " %s", $i
            }
            printf "\" >> /var/www/api/storage/logs/cron.log 2>&1;"
            for (i = 6; i <= NF; i++) {
                printf " %s", $i
            }
            print " >> /var/www/api/storage/logs/cron.log 2>&1"
        }
    ' /etc/hotel-utils/cron
} > /etc/cron.d/hotel-utils

chmod 0644 /etc/cron.d/hotel-utils

cron
exec tail -n 0 -F "$cron_log"
