<?php

namespace App\Http\Livewire;

use Livewire\Component;

class FrmConfigTextsEditor extends Component
{
    public $email_subject;
    public $email_text;
    public $page_text;

    // protected $listeners = [
    //     'selectedEventChanged' => '$refresh',
    // ];

    // public function mount($page_text)
    // {
    //     $this->page_text = $page_text;
    // }

    public function updateVal()
    {
        $this->page_text = 'teste';
        $this->refresh();
    }

    public function render()
    {
        return view('livewire.frm-config-texts-editor');
    }

    public function save()
    {
        dd($this->email_subject.' '.$this->email_text.' '.$this->page_text);
    }
}
