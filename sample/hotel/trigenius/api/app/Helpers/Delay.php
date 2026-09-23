<?php

namespace App\Helpers;

use Illuminate\Support\Facades\DB;

class Delay
{
    public static function get()
    {
        $ret = DB::table('jobs')->count() * 10;

        return $ret;
    }
}
