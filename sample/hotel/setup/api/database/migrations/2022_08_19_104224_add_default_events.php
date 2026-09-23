<?php

use App\Helpers\EventKeysEnum;
use App\Models\Event;
use Illuminate\Database\Migrations\Migration;

class AddDefaultEvents extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {

        Event::create([
            'code' => EventKeysEnum::CHECKIN,
            'name' => 'Checkin',
            'description' => 'Check in online!',
            'hours' => 0,
            'days_offset' => 0,
        ]);

        Event::create([
            'code' => EventKeysEnum::QUIZ,
            'name' => 'Quiz',
            'description' => 'Questionários!',
            'hours' => 0,
            'days_offset' => 0,
        ]);

        Event::create([
            'code' => EventKeysEnum::BIRTHDAY,
            'name' => 'Birthday',
            'description' => 'Email de aniversário!',
            'hours' => 0,
            'days_offset' => 0,
        ]);

        Event::create([
            'code' => EventKeysEnum::PROMO,
            'name' => 'Promo',
            'description' => 'Promoções!',
            'hours' => 0,
            'days_offset' => 0,
        ]);
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Event::truncate();
    }
}
