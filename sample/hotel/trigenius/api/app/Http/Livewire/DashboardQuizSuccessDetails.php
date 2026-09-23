<?php

namespace App\Http\Livewire;

use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Support\Carbon;
use Livewire\Component;

class DashboardQuizSuccessDetails extends Component
{
    public $filter;

    public $units;
    public $selected_unit;

    public $channels;
    public $selected_channel;

    public $quiz_success;
    public $quiz_success_filtered;

    protected $rules = [
        'selected_channel' => 'required',
    ];

    public function mount()
    {
        $this->quiz_success = Reservation::where('quiz_response', true)
            ->where('number', '>', 0)
            ->get();

        $this->filter = 'today';

        $this->units = Unit::all();
        $this->selected_unit = 'all';

        $this->channels = Reservation::select('channel')->distinct()->get();
        $this->selected_channel = 'all';

        $this->updatedFilter();
        // Log::debug($this->channels);
    }

    public function render()
    {
        return view('livewire.dashboard-quiz-success-details');
    }

    public function updatedSelectedUnit()
    {
        $this->updatedFilter();
    }

    public function updatedSelectedChannel()
    {
        $this->updatedFilter();
    }

    public function updatedFilter()
    {
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

        $this->quiz_success_filtered = $this->quiz_success->filter(function ($item) use ($start_date, $end_date) {
            if ($item['checkout']->format('Y-m-d') >= $start_date->format('Y-m-d') && $item['checkout']->format('Y-m-d') <= $end_date->format('Y-m-d')) {
                if ($item['unit_id'] == $this->selected_unit || $this->selected_unit == null || $this->selected_unit == 'all') {
                    if ($item['channel'] == $this->selected_channel || $this->selected_channel == 'all') {
                        return $item;
                    }
                }
            }
        });
    }
}
