<?php

namespace App\Http\Livewire;

use App\Models\Reservation;
use Livewire\Component;
use LivewireUI\Modal\ModalComponent;

class ModalDashboardQuizSuccessDetails extends ModalComponent
{

    public Reservation $reservation;

    public function mount(Reservation $reservation)
    {
        $this->reservation = $reservation;
    }

    public function render()
    {
        return view('livewire.modal-dashboard-quiz-success-details');
    }

    public function close()
    {
        $this->closeModal();
    }
}
