<?php

namespace App\View\Components;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Illuminate\View\Component;

class AppLogo extends Component
{
    protected ?Configuration $logo;

    /**
     * Create a new component instance.
     *
     * @return void
     */
    public function __construct()
    {
        $this->logo = Configuration::where('key', ConfigKeysEnum::LOGO)->first();
    }

    /**
     * Get the view / contents that represent the component.
     *
     * @return \Illuminate\Contracts\View\View|\Closure|string
     */
    public function render()
    {
        return view('components.app-logo', [
            'logo' => $this->logo,
        ]);
    }
}
