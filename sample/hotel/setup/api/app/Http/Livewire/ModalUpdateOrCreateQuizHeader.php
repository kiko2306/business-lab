<?php

namespace App\Http\Livewire;

use App\Models\QuizHeader;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateQuizHeader extends ModalComponent
{
    public $selected_quiz_id;
    public QuizHeader $quiz_header;

    protected $rules = [
        'quiz_header.quiz_id' => 'required',
        'quiz_header.title' => 'required',
        'quiz_header.is_active' => 'boolean',
        'quiz_header.order' => 'required|numeric',
    ];

    public function mount($selected_quiz_id, ?QuizHeader $qh)
    {
        $this->selected_quiz_id = $selected_quiz_id;
        $this->quiz_header = $qh->id ? $qh : new QuizHeader([
            'quiz_id' => $selected_quiz_id,
            'title' => '',
            'is_active' => true,
            'order' => QuizHeader::where('quiz_id', $this->selected_quiz_id)->max('order') + 1,
        ]);
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-quiz-header');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate();
        $this->quiz_header->save();

        $this->emit('refreshQuizHeaders');
        $this->closeModal();
    }
}
