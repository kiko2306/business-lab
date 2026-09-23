<?php

namespace App\Http\Livewire;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Illuminate\Support\Facades\Storage;
use Livewire\Component;
use Livewire\WithFileUploads;
use Illuminate\Support\Str;

class FrmConfigLogo extends Component
{
    use WithFileUploads;

    public $logo;
    public $config_logo;

    protected $rules = [
        'config_logo.key' => 'required',
        'logo' => 'required|image|max:1024',
    ];

    public function mount()
    {
        $this->config_logo = Configuration::where('key', ConfigKeysEnum::LOGO)->first() ?? new Configuration([
            'key' => ConfigKeysEnum::LOGO,
        ]);
    }

    public function render()
    {
        return view('livewire.frm-config-logo');
    }

    public function save()
    {
        $this->validate();

        Storage::delete('public/uploads/'.$this->config_logo->value);

        $filename = $this->logo->store('public/uploads');
        $filename = Str::replace('public/uploads/', '', $filename);

        $this->config_logo->value = $filename;
        $this->config_logo->save();

        $this->logo = null;
    }
}
