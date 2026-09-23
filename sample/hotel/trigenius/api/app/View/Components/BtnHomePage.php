<?php

namespace App\View\Components;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use Illuminate\View\Component;

class BtnHomePage extends Component
{
    protected $url_home_page;

    /**
     * Create a new component instance.
     *
     * @return void
     */
    public function __construct()
    {
        $this->url_home_page = Configuration::where('key', ConfigKeysEnum::URL_HOME_PAGE)->first();
    }

    /**
     * Get the view / contents that represent the component.
     *
     * @return \Illuminate\Contracts\View\View|\Closure|string
     */
    public function render()
    {
        return view('components.btn-home-page', [
            'url_home_page' => $this->url_home_page,
        ]);
    }
}
