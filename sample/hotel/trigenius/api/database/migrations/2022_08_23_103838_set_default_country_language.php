<?php

use App\Models\Country;
use App\Models\Language;
use Illuminate\Database\Migrations\Migration;

class SetDefaultCountryLanguage extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Country::where('code', 'PT')->update(['language_id' => Language::where('code', 'PT')->first()->id]);
        Country::where('code', 'GB')->update(['language_id' => Language::where('code', 'EN')->first()->id]);
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {

    }
}
