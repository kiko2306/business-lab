<?php

namespace App\Http\Livewire;

use App\Models\Unit;
use App\Models\User;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateOrCreateUser extends ModalComponent
{
    public User $user;
    public $units;

    public $selected_units = [];

    public function rules()
    {
        return [
        'user.name' => 'required',
        'user.email' => 'required|unique:users,email,'.$this->user->id,
        'user.is_admin' => 'boolean',
        'user.email_quiz_response' => 'boolean',
        'user.email_check_in_response' => 'boolean',
        'user.notify_guest_no_mail' => 'boolean',
        'user.notify_guest_invalid_mail' => 'boolean',
        'user.notify_service_connection_delay' => 'boolean',
        ];
    }

    public function mount(?User $user)
    {
        $this->user = $user->id ? $user : new User([
             'is_admin' => false,
             'email_quiz_response' => false,
             'email_check_in_response' => false,
             'notify_guest_no_mail' => false,
             'notify_guest_invalid_mail' => false,
             'notify_service_connection_delay' => false,
            ]);
        $this->units = Unit::all();
        $this->selected_units = $user->units->pluck('id');
    }

    public function render()
    {
        return view('livewire.modal-update-or-create-user');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate();

        $this->user = User::updateOrCreate(
            ['id' => $this->user->id],
            $this->user->attributesToArray()
        );

        $this->user->setUnits($this->selected_units);
        $this->emit('usersLstUpdated');
        $this->close();
    }
}
