<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use App\Models\Unit;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateQuiz extends ModalComponent
{
    public Quiz $quiz;
    public $units;
    public $selected_unit_id;

    protected $rules = [
        'quiz.name' => 'required',
        'quiz.is_active' => 'boolean',
        'selected_unit_id' => 'required',
    ];

    public function mount(?Quiz $quiz)
    {
        $this->units = Unit::all();
        $this->selected_unit_id = $quiz->unit->id ?? $this->units[0]->id;
        $this->quiz = $quiz->id ? $quiz : new Quiz(['name' => '', 'is_active' => false]);
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-quiz');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->quiz->save();
        $u = Unit::find($this->selected_unit_id);
        $u->checkout_quiz_id = $this->quiz->id;
        $u->save();
        $this->emit('quizzesChanged');
        $this->closeModal();
    }
}
