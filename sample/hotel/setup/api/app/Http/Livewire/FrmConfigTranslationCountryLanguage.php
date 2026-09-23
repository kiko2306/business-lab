<?php

namespace App\Http\Livewire;

use App\Models\Country;
use App\Models\Language;
use Livewire\Component;

class FrmConfigTranslationCountryLanguage extends Component
{
    public $countries;
    public $languages;
    public $saved;

    protected $rules = [
        'countries.*.language_id' => 'integer',
    ];

    public function mount()
    {
        $this->getData();
    }

    public function getData()
    {
        $this->countries = Country::orderBy('language_id', 'desc')->get();
        $this->languages = Language::all();
    }

    public function render()
    {
        return view('livewire.frm-config-translation-country-language');
    }

    public function closeAlert()
    {
        $this->saved = false;
    }

    public function removeLanguage(Country $country)
    {
        $country->language_id = null;
        $country->save();
        $this->getData();
    }

    public function save()
    {
        $this->validate();

        foreach ($this->countries as $country) {
            $country->save();
        }

        $this->saved = true;
        $this->getData();
    }
}
