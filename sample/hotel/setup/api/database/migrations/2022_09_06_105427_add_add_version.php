<?php

use App\Models\Version;
use Illuminate\Database\Migrations\Migration;

class AddAddVersion extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Version::created([
            'code' => '2.0.0',
            'description' => 'Versão 2',
        ]);
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Version::truncate();
    }
}
