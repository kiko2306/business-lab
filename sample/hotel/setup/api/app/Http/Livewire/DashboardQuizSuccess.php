<?php

namespace App\Http\Livewire;

use App\Models\Reservation;
use App\Models\Style;
use Livewire\Component;

class DashboardQuizSuccess extends Component
{
    public $value;
    public $percentage;
    public $style;

    public function mount()
    {
        $this->value = Reservation::where('quiz_response', true)
            ->where('number', '>', 0)
            ->count();

        if ($this->value > 0) {
            $this->percentage = round($this->value / Reservation::where('quiz_sent', true)
            ->where('number', '>', 0)
            ->count(), 2) * 100;
        } else {
            $this->percentage = 0;
        }

        $this->style = Style::active();
    }

    public function render()
    {
        return view('livewire.dashboard-quiz-success');
    }
}
