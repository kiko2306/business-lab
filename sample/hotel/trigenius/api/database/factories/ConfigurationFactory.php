<?php

namespace Database\Factories;

use App\Helpers\ConfigKeysEnum;
use Illuminate\Database\Eloquent\Factories\Factory;

class ConfigurationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'key' => ConfigKeysEnum::getRandomValue(),
            'value' => $this->faker->word(),
        ];
    }
}
