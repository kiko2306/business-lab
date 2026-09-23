<?php

namespace App\Http\Livewire;

use App\Models\Style;
use Livewire\Component;

class DashboardQuizResponses extends Component
{
    // TODO: rename DashboardQuizAnswers

    public $style;

    public function mount()
    {
        $this->style = Style::active();
    }

    public function render()
    {
        return view('livewire.dashboard-quiz-responses');
    }
}
