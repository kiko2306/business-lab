<?php

namespace App\Http\Livewire;

use App\Models\User;
use Livewire\Component;
use Livewire\WithPagination;

class FrmConfigUsers extends Component
{
    use WithPagination;

    // public $users;
    public $selected_user;
    public $user_modal_title;

    protected $listeners = [
        'usersLstUpdated' => '$refresh',
    ];

    public function render()
    {
        return view('livewire.frm-config-users', [
            'users' => User::where('id', '!=', 1)->paginate(5),
        ]);
    }
}
