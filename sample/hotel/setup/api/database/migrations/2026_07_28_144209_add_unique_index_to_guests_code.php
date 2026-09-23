<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AddUniqueIndexToGuestsCode extends Migration
{
    public function up()
    {
        Schema::table('guests', function (Blueprint $table) {
            $table->unique('code');
        });
    }

    public function down()
    {
        Schema::table('guests', function (Blueprint $table) {
            $table->dropUnique(['code']);
        });
    }
}
