<?php

namespace App\Http\Livewire;

use App\Models\Language;
use App\Models\QuizQuestion;
use App\Models\QuizQuestionTranslation;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateQuizQuestionTranslation extends ModalComponent
{
    public $language_id;
    public $question;
    public $value;

    protected $rules = [
        'language_id' => 'required',
        'question.id' => 'required',
        'value' => 'required',
    ];

    public function mount($language_id, QuizQuestion $question)
    {
        $this->language_id = $language_id;
        $this->question = $question;
        $this->value = $question->translation(Language::find($language_id))->first()->value ?? '';
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-quiz-question-translation');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate();

        QuizQuestionTranslation::updateOrCreate(
            [
                'quiz_question_id' => $this->question->id,
                'language_id' => $this->language_id,
            ],
            [
                'quiz_question_id' => $this->question->id,
                'language_id' => $this->language_id,
                'value' => $this->value,
            ]
        );

        $this->emit('refreshTranslations');
        $this->closeModal();
    }
}
