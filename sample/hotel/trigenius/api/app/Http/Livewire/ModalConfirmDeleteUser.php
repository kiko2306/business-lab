<?php

namespace App\Http\Livewire;

use App\Models\User;
use LivewireUI\Modal\ModalComponent;

class ModalConfirmDeleteUser extends ModalComponent
{
    public User $user;

    public function mount(User $user)
    {
        $this->user = $user;
    }

    public function render()
    {
        return view('livewire.modal-confirm-delete-user');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->user->setUnits([]);
        $this->user->delete();
        $this->emit('usersLstUpdated');
        $this->closeModal();
    }
}
