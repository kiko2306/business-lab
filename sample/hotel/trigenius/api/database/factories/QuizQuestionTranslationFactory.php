<?php

namespace Database\Factories;

use App\Models\Language;
use App\Models\QuizQuestionTranslation;
use Illuminate\Database\Eloquent\Factories\Factory;

class QuizQuestionTranslationFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'quiz_question_id' => 0,
            'language_id' => 131,
            'value' => $this->faker->sentence(),
        ];
    }

    public function defValue()
    {
        return $this->afterMaking(function (QuizQuestionTranslation $qh) {
            $qh->value = '['.Language::where('id', $qh->language_id)->first()->code.']'.$qh->value;
        })->afterCreating(function (QuizQuestionTranslation $qh) {
            $qh->value = '['.Language::where('id', $qh->language_id)->first()->code.']'.$qh->value;
        });
    }
}
