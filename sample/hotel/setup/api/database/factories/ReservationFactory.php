<?php

namespace Database\Factories;

use App\Helpers\ReservationStatusKeysEnum;
use App\Models\Guest;
use App\Models\Unit;
use Illuminate\Database\Eloquent\Factories\Factory;

class ReservationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'unit_id' => Unit::all()->random()->id,
            'number' => $this->faker->unique()->numberBetween(1, 10000),
            'line' => $this->faker->numberBetween(1, 2),
            'guest_id' => Guest::all()->random()->id,
            'room_code' => 'Room '.$this->faker->numberBetween(1, 50),
            'room_name' => 'Quarto '.$this->faker->word(),
            'adults' => $this->faker->numberBetween(1, 2),
            'children' => $this->faker->numberBetween(0, 2),
            'babies' => $this->faker->numberBetween(0, 2),
            'checkin' => $this->faker->dateTimeBetween('-15 days', '+10 days')->format('Y-m-d'),
            'checkout' => $this->faker->dateTimeBetween('-6 days', '0 days')->format('Y-m-d'),
            'status' => ReservationStatusKeysEnum::getRandomValue(),
        ];
    }
}
