FROM php:7.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        cron \
        gosu \
        libfreetype6-dev \
        libicu-dev \
        libjpeg62-turbo-dev \
        libonig-dev \
        libpng-dev \
        libzip-dev \
        unzip \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" \
        bcmath \
        gd \
        intl \
        mbstring \
        pdo_mysql \
        zip \
    && a2enmod rewrite \
    && sed -ri \
        -e 's!/var/www/html!/var/www/fe!g' \
        /etc/apache2/sites-available/*.conf \
        /etc/apache2/apache2.conf \
        /etc/apache2/conf-available/*.conf \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

WORKDIR /var/www/api

COPY composer.json composer.lock ./
RUN composer install \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --prefer-dist

COPY docker-entrypoint.sh /usr/local/bin/hotel-utils-entrypoint
COPY cron-entrypoint.sh /usr/local/bin/hotel-utils-cron-entrypoint
RUN chmod +x \
        /usr/local/bin/hotel-utils-entrypoint \
        /usr/local/bin/hotel-utils-cron-entrypoint \
    && mkdir -p /var/www/fe

EXPOSE 80

ENTRYPOINT ["hotel-utils-entrypoint"]
