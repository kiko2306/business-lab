<?php

namespace App\Http\Livewire;

use App\Models\Quiz;
use App\Models\Unit;
use Livewire\Component;

class FrmConfigUnits extends Component
{
    public $units;
    public $quizzes;
    public $saved;

    protected $rules = [
        'units.*.checkout_quiz_is_active' => 'required|boolean',
        'units.*.checkin_is_active' => 'required|boolean',
        'units.*.birthday_is_active' => 'required|boolean',
        'units.*.promo_is_active' => 'required|boolean',
        'units.*.checkout_quiz_id' => ['numeric', 'nullable', 'exists:quizzes,id'],
    ];

    public function mount()
    {
        $this->units = Unit::all();
        $this->quizzes = Quiz::all();
    }

    public function render()
    {
        return view('livewire.frm-config-units');
    }

    public function save()
    {
        $this->validate();

        foreach ($this->units as $unit) {
            $unit->save();
        }

        $this->saved = true;
    }

    public function closeAlert()
    {
        $this->saved = false;
    }

    public function change($key)
    {
        if ($this->units[$key]->checkout_quiz_id == 0) {
            $this->units[$key]->checkout_quiz_is_active = false;
        }
    }
}
