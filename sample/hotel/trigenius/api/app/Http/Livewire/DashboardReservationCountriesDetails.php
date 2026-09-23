<?php

namespace App\Http\Livewire;

use App\Models\Guest;
use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Support\Carbon;
use Livewire\Component;

class DashboardReservationCountriesDetails extends Component
{
    public $countries;
    public $countries_count;
    public $selected_country;

    public $units;
    public $selected_unit;

    public $filter;
    public $reservations;
    public $reservation_filtered;

    public function mount()
    {
        $this->countries = Guest::select('country')->distinct()->get()->pluck('country');
        $this->units = Unit::all();
        $this->reservations = Reservation::all();

        $this->filter = 'today';
        $this->selected_unit = 'all';
        $this->countries_count = [];
        $this->updatedFilter();
    }

    public function render()
    {
        return view('livewire.dashboard-reservation-countries-details');
    }

    public function updatedSelectedUnit()
    {
        $this->updatedFilter();
    }

    public function updatedFilter()
    {
        $this->countries_count = [];
        $start_date = Carbon::now();
        $end_date = Carbon::now();

        switch ($this->filter) {
            case 'today':
                // code...
                break;
            case 'yesterday':
                $start_date = Carbon::now()->subDay(1);
                $end_date = Carbon::now()->subDay(1);
                break;
            case 'last_week':
                $start_date = Carbon::now()->subWeek(1);
                break;
            case 'last_month':
                $start_date = Carbon::now()->subMonth(1);
                break;
            case 'last_year':
                $start_date = Carbon::now()->subYear(1);
                break;
            case 'all':
                $start_date = Carbon::now()->subYear(50);
                break;
            default:
                // code...
                break;
        }

        $this->reservation_filtered = $this->reservations->filter(function ($item) use ($start_date, $end_date) {
            if ($item['checkin']->format('Y-m-d') >= $start_date->format('Y-m-d') && $item['checkin']->format('Y-m-d') <= $end_date->format('Y-m-d')) {
                if ($item['unit_id'] == $this->selected_unit || $this->selected_unit == null || $this->selected_unit == 'all') {
                    if ($item->guest && array_key_exists($item->guest->country, $this->countries_count ?? [])) {
                        ++$this->countries_count[$item->guest->country];
                    } else {
                        if ($item->guest) {
                            $this->countries_count[$item->guest->country] = 1;
                        }
                    }

                    return $item;
                }
            }
        });

        $this->countries_count = collect($this->countries_count)->sort()->reverse()->toArray();
    }
}
