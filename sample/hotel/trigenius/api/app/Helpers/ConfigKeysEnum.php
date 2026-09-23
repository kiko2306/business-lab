<?php

namespace App\Helpers;

class ConfigKeysEnum
{
    public const WINTOUCH_USER = 'WINTOUCH_USER';
    public const WINTOUCH_PASSWORD = 'WINTOUCH_PASSWORD';
    public const WINTOUCH_DATABASE = 'WINTOUCH_DATABASE';

    public const LOGO = 'LOGO';
    public const URL_HOME_PAGE = 'URL_HOME_PAGE';

    public static function getRandomValue()
    {
        $values = [
            self::WINTOUCH_USER,
            self::WINTOUCH_PASSWORD,
            self::WINTOUCH_DATABASE,
            self::LOGO,
            self::URL_HOME_PAGE,
        ];

        return $values[array_rand($values)];
    }
}
