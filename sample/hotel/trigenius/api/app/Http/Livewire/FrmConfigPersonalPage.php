<?php

namespace App\Http\Livewire;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Livewire\Component;

class FrmConfigPersonalPage extends Component
{
    public $url;
    public $saved;

    protected $rules = [
        'url' => 'required|url',
    ];

    public function mount()
    {
        $url_config = Configuration::where('key', ConfigKeysEnum::URL_HOME_PAGE)->first() ??
        new Configuration([
            'key' => ConfigKeysEnum::URL_HOME_PAGE,
        ]);

        $this->url = $url_config->value;
    }

    public function render()
    {
        return view('livewire.frm-config-personal-page');
    }

    public function save()
    {
        $this->validate();

        Configuration::updateOrCreate(
            [
                'key' => ConfigKeysEnum::URL_HOME_PAGE,
            ],
            [
                'value' => $this->url,
            ]
        );

        $this->saved = true;
    }

    public function closeAlert()
    {
        $this->saved = false;
        $this->resetErrorBag();
    }
}
