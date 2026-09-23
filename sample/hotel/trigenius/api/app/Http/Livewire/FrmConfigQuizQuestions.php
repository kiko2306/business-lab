<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use App\Models\QuizHeader;
use App\Models\QuizQuestion;
use Livewire\Component;

class FrmConfigQuizQuestions extends Component
{
    public $quizzes;
    public int $selected_quiz_id;
    public $quiz_headers = [];

    protected $listeners = [
        'refreshQuizQuestions' => 'getHeaders',
    ];

    public function mount()
    {
        $this->quizzes = Quiz::all();
        $this->selected_quiz_id = $this->quizzes[0]->id;
        $this->getHeaders();
    }

    public function render()
    {
        return view('livewire.frm-config-quiz-questions');
    }

    public function getHeaders()
    {
        $this->quiz_headers = QuizHeader::where('quiz_id', $this->selected_quiz_id)
        ->orderBy('order', 'asc')
        ->get();
    }

    public function updateTaskOrder($list)
    {
        foreach ($list as $item) {
            QuizQuestion::find($item['value'])->update(['order' => $item['order']]);
        }

        $this->getHeaders();
    }
}
