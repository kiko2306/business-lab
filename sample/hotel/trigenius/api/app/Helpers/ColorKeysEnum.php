<?php

namespace App\Helpers;

use Illuminate\Support\Facades\Log;

class ColorKeysEnum
{
    public const PRIMARY = '#007bff';
    public const SECONDARY = '#6c757d';
    public const SUCCESS = '#28a745';
    public const DANGER = '#dc3545';
    public const WARNING = '#ffc107';
    public const INFO = '#17a2b8';
    public const LIGHT = '#f8f9fa';
    public const DARK = '#343a40';
    public const WHITE = '#fff';
    public const BLACK = '#000';
    public const TEXT_ON_COLOR = '#fff';

    public static function getColors(): array
    {
        return [
            self::PRIMARY,
            self::SECONDARY,
            self::SUCCESS,
            self::DANGER,
            self::WARNING,
            self::INFO,
            self::LIGHT,
            self::DARK,
            self::WHITE,
            self::BLACK,
        ];
    }

    public static function getColorKeys(): array
    {
        return [
            'PRIMARY',
            'SECONDARY',
            'SUCCESS',
            'DANGER',
            'WARNING',
            'INFO',
            'LIGHT',
            'DARK',
            'WHITE',
            'BLACK',
        ];
    }

    public static function getEditableColorKeys(): array
    {
        return [
            'PRIMARY',
            'SECONDARY',
            'SUCCESS',
            'DANGER',
            'WARNING',
            'INFO',
        ];
    }

    public static function getKeyValue($key)
    {
        return constant("self::$key");
    }

    // TODO: verify if this is the best way to do this and if is used
    public static function getKeyByColor($color)
    {
        // Log::debug($color);
        $haystack = self::getColors();
        // Log::debug($haystack);

        $index = array_search($color, $haystack);

        // Log::debug(self::getColorKeys()[$index]);

        return self::getColorKeys()[$index];
    }
}
