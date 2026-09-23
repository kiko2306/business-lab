<?php

namespace App\Http\Livewire;

use App\Helpers\QuizQuestionTypeKeyEnum;
use App\Models\QuizQuestion;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateQuizQuestion extends ModalComponent
{
    public $quiz_header_id;
    public $quiz_question;

    protected $rules = [
        'quiz_question.quiz_header_id' => 'required',
        'quiz_question.question' => 'required',
        'quiz_question.order' => 'required',
        'quiz_question.type' => 'required',
        'quiz_question.is_active' => 'boolean',
    ];

    public function mount(int $quiz_header_id, ?QuizQuestion $quiz_question = null)
    {
        $this->quiz_header_id = $quiz_header_id;
        $this->quiz_question = $quiz_question->id ? $quiz_question : new QuizQuestion([
            'quiz_header_id' => $quiz_header_id,
            'order' => QuizQuestion::where('quiz_header_id', $quiz_header_id)->max('order') + 1,
            'type' => QuizQuestionTypeKeyEnum::TEXT,
            'is_active' => true,
        ]);
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-quiz-question');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate();

        $this->quiz_question->save();

        $this->emit('refreshQuizQuestions');
        $this->closeModal();
    }
}
