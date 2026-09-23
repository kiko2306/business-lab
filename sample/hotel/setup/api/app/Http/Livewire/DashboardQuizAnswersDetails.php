<?php

namespace App\Http\Livewire;

use App\Helpers\QuizQuestionTypeKeyEnum;
use App\Models\Quiz;
use App\Models\QuizQuestion;
use App\Models\QuizResponse;
use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Support\Carbon;
use Livewire\Component;

class DashboardQuizAnswersDetails extends Component
{
    //TODO: alterar filtro pequisa por questionario e nao por unidade.
    public $filter;

    public $units;
    public $selected_unit;

    public $quizzes;
    public $selected_quiz;

    // public $channels;
    // public $selected_channel;
    public $quiz_success;
    public $quiz_success_filtered;

    protected $rules = [
        'selected_channel' => 'required',
        'selected_unit' => 'required',
    ];

    public function mount()
    {
        $this->quiz_success = Reservation::where('quiz_response', true)
            ->where('number', '>', 0)
            ->get();

        $this->filter = 'today';

        $this->units = Unit::all();
        $this->selected_unit = $this->units->first()->id;

        $this->quizzes = Quiz::all();

        $this->updatedFilter();
    }

    public function render()
    {
        return view('livewire.dashboard-quiz-answers-details');
    }

    public function updatedSelectedUnit()
    {
        $this->updatedFilter();
    }

    public function updatedFilter()
    {
        $this->selected_quiz = Unit::find($this->selected_unit)->quiz;

        $start_date = Carbon::now();
        $end_date = Carbon::now();

        switch ($this->filter) {
            case 'today':
                // code...
                break;
            case 'yesterday':
                $start_date = Carbon::now()->subDay(1);
                $end_date = Carbon::now()->subDay(1);
                break;
            case 'last_week':
                $start_date = Carbon::now()->subWeek(1);
                break;
            case 'last_month':
                $start_date = Carbon::now()->subMonth(1);
                break;
            case 'last_year':
                $start_date = Carbon::now()->subYear(1);
                break;
            case 'all':
                $start_date = Carbon::now()->subYear(50);
                break;
            default:
                // code...
                break;
        }

        $this->quiz_success_filtered = $this->quiz_success->filter(function ($item) use ($start_date, $end_date) {
            if ($item['checkout']->format('Y-m-d') >= $start_date->format('Y-m-d') && $item['checkout']->format('Y-m-d') <= $end_date->format('Y-m-d')) {
                if ($item['unit_id'] == $this->selected_unit || $this->selected_unit == null || $this->selected_unit == 'all') {
                    return $item;
                }
            }
        });
    }

    public function getTotalAnswers(QuizQuestion $q)
    {
        $points = 0;
        $quizzes = 0;

        foreach ($this->quiz_success_filtered as $reservation) {
            $response = QuizResponse::where('reservation_id', $reservation->id)
                ->where('quiz_question_id', $q->id)
                ->first();

            if ($response) {
                if ($response->quizQuestion->type == QuizQuestionTypeKeyEnum::VALUE) {
                    if ($response->answer) {
                        try {
                            $points += $response->answer;
                            ++$quizzes;
                        } catch (\Throwable $th) {
                            $points += 0;
                        }
                    }
                }
            }
        }

        return ['quizzes' => $quizzes, 'value' => $quizzes == 0 ? 0 : round($points / $quizzes, 2)];
    }
}
