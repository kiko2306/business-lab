<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use App\Models\Unit;
use LivewireUI\Modal\ModalComponent;

class ModalConfirmDeleteQuiz extends ModalComponent
{
    public Quiz $quiz;

    public function mount(Quiz $quiz)
    {
        $this->quiz = $quiz;
    }

    public function render()
    {
        return view('livewire.modal-confirm-delete-quiz');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->quiz->delete();

        $units = Unit::where('checkout_quiz_id', $this->quiz->id)->get();

        foreach ($units as $unit) {
            $unit->checkout_quiz_id = 0;
        }

        $this->emit('quizzesChanged');

        $this->closeModal();
    }
}
