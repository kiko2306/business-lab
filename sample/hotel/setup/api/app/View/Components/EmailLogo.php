<?php

namespace App\View\Components;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Illuminate\View\Component;

class EmailLogo extends Component
{
    protected ?Configuration $logo;
    protected $message;

    /**
     * Create a new component instance.
     *
     * @return void
     */
    public function __construct($message)
    {
        $this->logo = Configuration::where('key', ConfigKeysEnum::LOGO)->first();
        $this->message = $message;
    }

    /**
     * Get the view / contents that represent the component.
     *
     * @return \Illuminate\Contracts\View\View|\Closure|string
     */
    public function render()
    {
        return view('components.email-logo', [
            'logo' => $this->logo,
            'message' => $this->message,
        ]);
    }
}
