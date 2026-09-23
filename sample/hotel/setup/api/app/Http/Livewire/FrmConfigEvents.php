<?php

namespace App\Http\Livewire;

use App\Models\Event;
use Livewire\Component;

class FrmConfigEvents extends Component
{
    public $events;
    public $saved = false;

    protected $rules = [
        'events.*.is_active' => 'boolean',
        'events.*.days_offset' => 'required',
    ];

    public function mount()
    {
        $this->events = Event::all();
    }

    public function render()
    {
        return view('livewire.frm-config-events');
    }

    public function save()
    {
        foreach ($this->events as $event) {
            $event->save();
        }

        $this->saved = true;
    }

    public function closeAlert()
    {
        $this->saved = false;
    }
}
