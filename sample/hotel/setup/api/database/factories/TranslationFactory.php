<?php

namespace Database\Factories;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use Illuminate\Database\Eloquent\Factories\Factory;

class TranslationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'key' => TranslationKeysEnum::getRandomValue(),
            'value' => $this->faker->text,
            'language_id' => Language::all()->random()->id,
        ];
    }
}
