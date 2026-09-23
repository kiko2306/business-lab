<?php

namespace App\Http\Livewire;

use App\Models\Country;
use App\Models\Guest;
use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Livewire\Component;

class FrmConfigTestCheckin extends Component
{
    public $units;
    public $countries;
    public $selected_unit_id;
    public $selected_name;
    public $selected_email;
    public $selected_country;
    public $selected_checkin_date;
    public $selected_checkout_date;
    public $selected_adults;
    public $selected_children;
    public $selected_babies;

    public $saved;

    protected $rules = [
        'selected_unit_id' => 'required|integer',
        'selected_name' => 'required|string',
        'selected_email' => 'required|email',
        'selected_country' => 'required|string',
        'selected_checkin_date' => 'required|date',
        'selected_checkout_date' => 'required|date',
        'selected_adults' => 'required|integer',
        'selected_children' => 'required|integer',
        'selected_babies' => 'required|integer',
    ];

    public function mount()
    {
        $this->units = Unit::all();
        $this->countries = Country::all();

        $this->selected_unit_id = $this->units[0]->id;
        $this->selected_name = 'John Doe';
        $this->selected_email = 'test@domain.com';
        $this->selected_country = $this->countries->where('code', 'PT')->first()->code;
        $this->selected_checkin_date = Carbon::now()->format('Y-m-d');
        $this->selected_checkout_date = Carbon::now()->addDays(3)->format('Y-m-d');
        $this->selected_adults = 1;
        $this->selected_children = 0;
        $this->selected_babies = 0;
    }

    public function render()
    {
        return view('livewire.frm-config-test-checkin');
    }

    public function closeAlert()
    {
        $this->saved = false;
    }

    public function save()
    {
        $this->validate();

        $guest = Guest::updateOrCreate([
            'code' => 'TEST_CODE',
        ], [
            'name' => $this->selected_name,
            'email' => $this->selected_email,
            'nationality' => $this->selected_country,
        ]);

        Reservation::create([
            'unit_id' => $this->selected_unit_id,
            'number' => -(Reservation::where('number', '<', 0)->count()) - 1,
            'line' => 1,
            'guest_id' => $guest->id,
            'room_code' => 'ROOM_TEST_CODE',
            'room_name' => 'ROOM_TEST_NAME',
            'adults' => $this->selected_adults,
            'children' => $this->selected_children,
            'babies' => $this->selected_babies,
            'checkin' => $this->selected_checkin_date,
            'checkout' => $this->selected_checkout_date,
        ]);

        Artisan::call('checkin:send');

        $this->saved = true;
    }
}
