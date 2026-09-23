<?php

namespace Database\Factories;

use App\Models\Language;
use App\Models\QuizHeaderTranslation;
use Illuminate\Database\Eloquent\Factories\Factory;

class QuizHeaderTranslationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'quiz_header_id' => 0,
            'language_id' => 131,
            'value' => $this->faker->sentence(),
        ];
    }

    public function defValue()
    {
        return $this->afterMaking(function (QuizHeaderTranslation $qh) {
            $qh->value = '['.Language::where('id', $qh->language_id)->first()->code.']'.$qh->value;
        })->afterCreating(function (QuizHeaderTranslation $qh) {
            $qh->value = '['.Language::where('id', $qh->language_id)->first()->code.']'.$qh->value;
        });
    }
}
