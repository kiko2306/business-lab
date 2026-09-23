<?php

namespace App\Http\Livewire;

use App\Models\Reservation;
use App\Models\Style;
use Livewire\Component;

class DashboardReservationNoEmail extends Component
{
    public $value;
    public $style;

    public function mount()
    {
        $this->value = Reservation::where('number', '>', 0)
            ->where('error_no_email', true)
            ->count();

        $this->style = Style::active();
    }

    public function render()
    {
        return view('livewire.dashboard-reservation-no-email');
    }
}
