<?php

namespace Database\Factories;

use App\Models\Quiz;
use Illuminate\Database\Eloquent\Factories\Factory;

class QuizFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array
     */
    public function definition()
    {
        $n = Quiz::all()->count() ?? 0;

        return [
            'name' => 'Questionario '.($n + 1),
            'is_active' => false,
        ];
    }
}
