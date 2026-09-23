<?php

use App\Models\Country;
use Illuminate\Database\Migrations\Migration;

class AddCountries extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        $countries = json_decode(file_get_contents(__DIR__.'/data/country-codes.json'), true);

        foreach ($countries as $country) {
            $c = new Country();
            $c->name = $country['name'];
            $c->code = $country['code'];
            $c->save();
        }
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Country::truncate();
    }
}
