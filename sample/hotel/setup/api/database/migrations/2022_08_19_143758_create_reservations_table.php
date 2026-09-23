<?php

use App\Helpers\ReservationStatusKeysEnum;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class CreateReservationsTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::create('reservations', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('unit_id');
            $table->integer('number');
            $table->integer('line');
            $table->unsignedBigInteger('guest_id')->nullable();
            $table->string('room_code')->nullable();
            $table->string('room_name')->nullable();
            $table->integer('adults')->default(1);
            $table->integer('children')->default(0);
            $table->integer('babies')->default(0);
            $table->date('checkin')->format('Y-m-d');
            $table->date('checkout')->format('Y-m-d');
            $table->boolean('checkin_sent')->default(false);
            $table->boolean('checkin_success')->default(false);
            $table->boolean('quiz_sent')->default(false);
            $table->boolean('quiz_response')->default(false);
            $table->boolean('error_no_email')->default(false);
            $table->boolean('error_invalid_email')->default(false);
            $table->string('status')->default(ReservationStatusKeysEnum::RESERVED);
            $table->string('channel')->nullable();
            $table->uuid('uuid')->unique();

            $table->unique(['unit_id', 'number', 'line']);

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
        Schema::dropIfExists('reservations');
    }
}
