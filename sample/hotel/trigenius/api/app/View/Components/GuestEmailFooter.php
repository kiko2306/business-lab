<?php

namespace App\View\Components;

use App\Models\Reservation;
use Illuminate\View\Component;

class GuestEmailFooter extends Component
{
    protected Reservation $reservation;

    /**
     * Create a new component instance.
     *
     * @return void
     */
    public function __construct(Reservation $reservation)
    {
        $this->reservation = $reservation;
    }

    /**
     * Get the view / contents that represent the component.
     *
     * @return \Illuminate\Contracts\View\View|\Closure|string
     */
    public function render()
    {
        return view('components.guest-email-footer', [
            'reservation' => $this->reservation,
        ]);
    }
}
