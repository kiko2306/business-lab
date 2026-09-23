<?php

namespace App\Helpers;

use App\Models\Guest;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class VarReplace
{
    public static function replace($text, ?Guest $guest = null)
    {
        if ($guest) {
            // Log::debug($guest->name.' '.$guest->lastName);
            $text = Str::replace('$guest', $guest->name.' '.$guest->last_name, $text);
        }

        // Log::debug($text);

        return $text;
    }

    public static function replaceHtml($text)
    {
        return strip_tags($text);
    }
}
