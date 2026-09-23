<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use App\Models\QuizHeader;
use Livewire\Component;

class FrmConfigQuizGroups extends Component
{
    public $quizzes;
    public int $selected_quiz_id;
    public $quiz_headers;

    public $listeners = [
        'refreshQuizHeaders' => 'getHeaders',
    ];

    public function mount()
    {
        $this->quizzes = Quiz::all();
        $this->selected_quiz_id = $this->quizzes[0]->id;
        $this->getHeaders();
    }

    public function render()
    {
        return view('livewire.frm-config-quiz-groups');
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
            QuizHeader::find($item['value'])->update(['order' => $item['order']]);
        }

        $this->getHeaders();
    }
}
