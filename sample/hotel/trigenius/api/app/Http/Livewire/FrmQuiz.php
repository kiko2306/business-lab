<?php

namespace App\Http\Livewire;

use App\Helpers\Delay;
use App\Helpers\TranslationKeysEnum;
use App\Jobs\NotifyAdminsNewQuizResponseJob;
use App\Models\QuizResponse;
use App\Models\Reservation;
use Livewire\Component;

class FrmQuiz extends Component
{
    public Reservation $reservation;
    public $quiz_headers;

    public $text;
    public $step = 0;

    public $header_text;
    public $question_text;
    public $question_type;
    public $question_id;

    public $header_n = 0;
    public $question_n = 0;

    public $finish = false;

    public $quiz_responses;

    public $language;

    public $rules = [
        'quiz_responses.*.answer' => '',
    ];

    public function mount(Reservation $reservation)
    {
        if ($reservation->quiz_response) {
            return view('quiz.duplicated');
        }

        $this->quiz_responses = collect();
        $this->reservation = $reservation;
        $this->language = $reservation->guest->getLanguage();

        $this->text = $reservation->guest->getTranslation(TranslationKeysEnum::QUIZ_PAGE_TEXT);

        $quiz_headers = $reservation->unit->quiz->headers;

        $this->quiz_headers = $quiz_headers->sortBy('order')->values();

        foreach ($this->quiz_headers as $qh) {
            foreach ($qh->quizQuestion->sortBy('order')->values() as $h) {
                $this->quiz_responses->push(new QuizResponse([
                    'quiz_question_id' => $h->id,
                    'answer' => '',
                ]));
            }
        }
    }

    public function render()
    {
        return view('livewire.frm-quiz');
    }

    public function next()
    {
        if ($this->quiz_headers[$this->header_n]->quizQuestion->count() == $this->question_n) {
            ++$this->header_n;
            $this->question_n = 1;
        } else {
            ++$this->question_n;
        }

        $this->header_text = $this->quiz_headers[$this->header_n];

        $questions = $this->quiz_headers[$this->header_n]->quizQuestion->sortBy('order')->values();

        $this->question_text = $questions[$this->question_n - 1];
        $this->question_type = $questions[$this->question_n - 1]->type;
        $this->question_id = $questions[$this->question_n - 1]->id;

        if ($this->header_n + 1 == $this->quiz_headers->count() &&
        $this->question_n == $this->quiz_headers[$this->header_n]->quizQuestion->count()) {
            $this->finish = true;
        }

        ++$this->step;
    }

    public function prev()
    {
        $this->finish = false;

        if ($this->step - 1 == 0) {
            --$this->step;
            $this->header_n = 0;
            $this->question_n = 0;

            return;
        }

        if ($this->question_n == 1) {
            --$this->header_n;
            $this->question_n = $this->quiz_headers[$this->header_n]->quizQuestion->count();
        } else {
            --$this->question_n;
        }

        $this->header_text = $this->quiz_headers[$this->header_n];

        $questions = $this->quiz_headers[$this->header_n]->quizQuestion->sortBy('order')->values();

        $this->question_text = $questions[$this->question_n - 1];
        $this->question_type = $questions[$this->question_n - 1]->type;
        $this->question_id = $questions[$this->question_n - 1]->id;

        --$this->step;
    }

    public function sendQuiz()
    {
        // save responses
        foreach ($this->quiz_responses as $key => $response) {
            QuizResponse::create([
                'reservation_id' => $this->reservation->id,
                'quiz_question_id' => $response['quiz_question_id'],
                'answer' => $response['answer'] == 'NR' ? '' : $response['answer'],
            ]);
        }

        // update reservation quiz_response
        $this->reservation->quiz_response = true;
        $this->reservation->save();

        // notify admins
        NotifyAdminsNewQuizResponseJob::dispatch($this->reservation)
            ->delay(Delay::get());

        // redirect to thank you page
        return redirect(route('quiz.thank_you', ['uuid' => $this->reservation->uuid]));
    }
}
