<?php

namespace App\Helpers;

use App\Models\Country;
use App\Models\Language;

class SetupLanguages
{
    public static function run()
    {
        $gb = Country::where('code', 'GB')->first();
        $gb->language_id = Language::where('code', 'EN')->first()->id;
        $gb->save();

        $fr = Country::where('code', 'FR')->first();
        $fr->language_id = Language::where('code', 'FR')->first()->id;
        $fr->save();

        $es = Country::where('code', 'ES')->first();
        $es->language_id = Language::where('code', 'ES')->first()->id;
        $es->save();

        $pt = Country::where('code', 'PT')->first();
        $pt->language_id = Language::where('code', 'PT')->first()->id;
        $pt->save();
    }
}
