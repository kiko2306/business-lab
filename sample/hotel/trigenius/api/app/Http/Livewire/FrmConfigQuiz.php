<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use Livewire\Component;

class FrmConfigQuiz extends Component
{
    public $quizzes;

    protected $listeners = ['quizzesChanged' => 'getData'];

    public function mount()
    {
        $this->getData();
    }

    public function getData()
    {
        $this->quizzes = Quiz::all();
    }

    public function render()
    {
        return view('livewire.frm-config-quiz');
    }
}
