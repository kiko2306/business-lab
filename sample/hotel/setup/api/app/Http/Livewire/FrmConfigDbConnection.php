<?php

namespace App\Http\Livewire;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Livewire\Component;

class FrmConfigDbConnection extends Component
{
    public $user_name;
    public $user_password;
    public $database;
    public bool $saved;

    protected $rules = [
        'user_name' => 'required',
        'user_password' => 'required',
        'database' => 'required',
    ];

    public function mount()
    {
        $this->user_name = Configuration::where('key', ConfigKeysEnum::WINTOUCH_USER)->first()->value
            ?? null;

        $this->user_password = Configuration::where('key', ConfigKeysEnum::WINTOUCH_PASSWORD)->first()->value
        ?? null;

        $this->database = Configuration::where('key', ConfigKeysEnum::WINTOUCH_DATABASE)->first()->value
        ?? null;
    }

    public function render()
    {
        return view('livewire.frm-config-db-connection');
    }

    public function save()
    {
        $this->validate();

        Configuration::updateOrCreate(
            [
                'key' => ConfigKeysEnum::WINTOUCH_USER,
            ],
            [
                'value' => $this->user_name,
            ]
        );

        Configuration::updateOrCreate(
            [
                    'key' => ConfigKeysEnum::WINTOUCH_PASSWORD,
                ],
            [
                    'value' => $this->user_password,
                ]
        );

        Configuration::updateOrCreate(
            [
                'key' => ConfigKeysEnum::WINTOUCH_DATABASE,
            ],
            [
                'value' => $this->database,
            ]
        );

        $this->saved = true;
    }

    public function closeAlert()
    {
        $this->saved = false;
    }
}
