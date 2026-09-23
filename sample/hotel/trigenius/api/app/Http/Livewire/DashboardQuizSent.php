<?php

namespace App\Http\Livewire;

use App\Models\Reservation;
use App\Models\Style;
use Livewire\Component;

class DashboardQuizSent extends Component
{
    public $value;
    public $style;

    public function mount()
    {
        $this->value = Reservation::where('quiz_sent', true)
            ->where('number', '>', 0)
            ->count();

        $this->style = Style::active();
    }

    public function render()
    {
        return view('livewire.dashboard-quiz-sent');
    }
}
