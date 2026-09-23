<?php

namespace Database\Seeders;

use App\Helpers\SetupLanguages;
use App\Models\Guest;
use App\Models\Language;
use App\Models\Quiz;
use App\Models\QuizHeader;
use App\Models\QuizHeaderTranslation;
use App\Models\QuizQuestion;
use App\Models\QuizQuestionTranslation;
use App\Models\Unit;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     *
     * @return void
     */
    public function run()
    {
        User::factory(5)->create();
        $units = Unit::factory(2)->create();
        Guest::factory(50)->create();

        SetupLanguages::run();

        foreach ($units as $unit) {
            $quiz = Quiz::factory()->create();
            $unit->checkout_quiz_id = $quiz->id;
            $unit->save();
        }

        foreach (Quiz::all() as $quiz) {
            for ($i = 1; $i < 5; ++$i) {
                $qh = QuizHeader::factory()->defTitle()->create([
                    'quiz_id' => $quiz->id,
                    'order' => $i,
                ]);

                $languages = Language::where('code', 'EN')->orWhere('code', 'FR')->orWhere('code', 'ES')->get();

                foreach ($languages as $language) {
                    QuizHeaderTranslation::factory()->defValue()->create([
                        'quiz_header_id' => $qh->id,
                        'language_id' => $language->id,
                    ]);
                }
            }
        }

        foreach (QuizHeader::all() as $qh) {
            $n_questions = rand(1, 3);
            for ($i = 0; $i < $n_questions; ++$i) {
                info($qh->id);
                $qq = QuizQuestion::factory()->create([
                    'quiz_header_id' => $qh->id,
                    'order' => $i + 1,
                ]);

                $languages = Language::where('code', 'EN')->orWhere('code', 'FR')->orWhere('code', 'ES')->get();

                foreach ($languages as $language) {
                    QuizQuestionTranslation::factory()->defValue()->create([
                        'quiz_question_id' => $qq->id,
                        'language_id' => $language->id,
                    ]);
                }
            }
        }
    }
}
