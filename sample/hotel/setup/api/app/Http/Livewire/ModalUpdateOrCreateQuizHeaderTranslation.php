<?php

namespace App\Http\Livewire;

use App\Models\Language;
use App\Models\QuizHeader;
use App\Models\QuizHeaderTranslation;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateQuizHeaderTranslation extends ModalComponent
{
    public $language_id;
    public $header;
    public $value;

    protected $rules = [
        'language_id' => 'required',
        'header.id' => 'required',
        'value' => 'required',
    ];

    public function mount($language_id, QuizHeader $header)
    {
        $this->language_id = $language_id;
        $this->header = $header;
        $this->value = $header->translation(Language::find($language_id))->first()->value ?? '';
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-quiz-header-translation');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate();

        $q = QuizHeaderTranslation::updateOrCreate(
            [
                // 'id' => $this->header->id,
                'quiz_header_id' => $this->header->id,
                'language_id' => $this->language_id,
            ],
            [
                'quiz_header_id' => $this->header->id,
                'language_id' => $this->language_id,
                'value' => $this->value,
            ]
        );

        $this->emit('refreshTranslations');
        $this->closeModal();
    }
}
