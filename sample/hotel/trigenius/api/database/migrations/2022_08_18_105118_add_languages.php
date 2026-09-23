<?php

use Illuminate\Database\Migrations\Migration;
use App\Models\Language;
use Illuminate\Support\Str;

class AddLanguages extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        $languages = json_decode(file_get_contents(__DIR__.'/data/language-codes.json'), true);

        foreach ($languages as $language) {
            $l = new Language();
            $l->name = $language['name'];
            $l->code = Str::upper($language['code']);
            if ($l->code === 'EN') {
                $l->default = true;
            }
            $l->save();
        }
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Language::truncate();
    }
}
