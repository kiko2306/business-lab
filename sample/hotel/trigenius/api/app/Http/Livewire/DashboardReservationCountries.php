<?php

namespace App\Http\Livewire;

use App\Models\Guest;
use App\Models\Style;
use Livewire\Component;

class DashboardReservationCountries extends Component
{
    public $value;
    public $style;

    public function mount()
    {
        $this->value = $this->countries = Guest::select('country')->distinct()->get()->pluck('country')->count();
        $this->style = Style::active();
    }

    public function render()
    {
        return view('livewire.dashboard-reservation-countries');
    }
}
