<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

class UnitFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        $id = $this->faker->numerify('###');

        return [
            'code' => 'Hotel'.$id,
            'name' => 'Hotel '.$id,
        ];
    }
}
