<?php

namespace Database\Factories;

use App\Helpers\QuizQuestionTypeKeyEnum;
use App\Models\QuizHeader;
use Illuminate\Database\Eloquent\Factories\Factory;

class QuizQuestionFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'quiz_header_id' => QuizHeader::all()->random()->id,
            'question' => '[PT] '.$this->faker->sentence,
            'type' => QuizQuestionTypeKeyEnum::getRandomValue(),
            'order' => 0,
        ];
    }
}
