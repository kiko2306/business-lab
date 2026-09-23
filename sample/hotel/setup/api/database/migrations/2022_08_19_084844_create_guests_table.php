<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateGuestsTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('guests', function (Blueprint $table) {
            $table->id();
            $table->string('code');
            $table->string('name')->nullable();
            $table->string('last_name')->nullable();
            $table->string('address1')->nullable();
            $table->string('address2')->nullable();
            $table->string('address3')->nullable();
            $table->string('zip_code')->nullable();
            $table->string('city')->nullable();
            $table->string('country')->nullable();
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->string('nif')->nullable();
            $table->smallInteger('gender')->nullable();
            $table->smallInteger('doc')->nullable();
            $table->string('doc_number')->nullable();
            $table->string('doc_number_id_control')->nullable();
            $table->date('doc_date')->nullable();
            $table->date('doc_valid')->nullable();
            $table->string('doc_local')->nullable();
            $table->string('doc_country')->nullable();
            $table->string('doc_by')->nullable();
            $table->string('birth_local')->nullable();
            $table->date('birth_date')->nullable();
            $table->string('nationality')->nullable();
            $table->boolean('mailable')->default(true);
            $table->boolean('has_changes')->default(false);
            $table->string('uuid')->unique()->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::dropIfExists('guests');
    }
}
