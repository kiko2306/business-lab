<?php

namespace Database\Factories;

use App\Models\QuizHeader;
use Illuminate\Database\Eloquent\Factories\Factory;

class QuizHeaderFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        return [
            'quiz_id' => 0,
            'title' => $this->faker->sentence,
            'order' => 0,
        ];
    }

    public function defTitle()
    {
        return $this->afterMaking(function (QuizHeader $qh) {
            $qh->title = '[Quiz: '.$qh->quiz_id.'] [PT] '.$qh->title;
        })->afterCreating(function (QuizHeader $qh) {
            $qh->title = '[Quiz: '.$qh->quiz_id.'] [PT]'.$qh->title;
        });
    }
}
