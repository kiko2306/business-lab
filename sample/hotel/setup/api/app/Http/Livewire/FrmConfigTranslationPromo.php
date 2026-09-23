<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Country;
use App\Models\Language;
use App\Models\Translation;
use Livewire\Component;

class FrmConfigTranslationPromo extends Component
{
    public $selected_translation_key;
    public $selected_modal;

    public $countries;
    public $languages;
    public $default_value;
    public $translated_values;

    public $rules = [
        'countries.*.language_id' => 'required',
        'countries.*.code' => 'required',
        'countries.*.name' => 'required',
        'translated_values.*.language_id' => 'required',
        'translated_values.*.value' => 'required',
    ];

    public $listeners = [
        'eventChanged' => 'updatedSelectedTranslationKey',
    ];

    public function mount()
    {
        $this->getCountries();
    }

    public function getCountries()
    {
        $this->countries = Country::select('language_id')
        ->where('language_id', '!=', '')
        ->where('language_id', '!=', Language::where('code', 'PT')->first()->id)
        ->distinct()
        ->get();
    }

    public function render()
    {
        return view('livewire.frm-config-translation-promo');
    }

    public function hasAllTranslations($key): bool
    {
        return Translation::where('key', $key)->count() - 1 == $this->countries->count();
    }

    public function setSelectedTranslationKey(string $selected_translation_key)
    {
        switch ($selected_translation_key) {
            case TranslationKeysEnum::PROMO_MAIL_SUBJECT:
                $this->selected_modal = 'modal-update-promo-email-subject';
                break;

            case TranslationKeysEnum::PROMO_MAIL_TEXT:
                $this->selected_modal = 'modal-update-promo-email-text';
                break;

            default:
                // code...
                break;
        }

        $this->selected_translation_key = $selected_translation_key;
        $this->updatedSelectedTranslationKey();
    }

    public function updatedSelectedTranslationKey()
    {
        $this->default_value = Translation::where('key', $this->selected_translation_key)
            ->where('language_id', Language::where('code', 'PT')->first()->id)
            ->first()->value;

        $this->translated_values = Translation::whereIn('language_id', $this->countries->pluck('language_id'))
            ->where('key', $this->selected_translation_key)
            ->get();

        foreach ($this->countries as $country) {
            if (!$this->translated_values->contains('language_id', $country->language_id)) {
                $this->translated_values->push(new Translation([
                        'key' => $this->selected_translation_key,
                        'language_id' => $country->language_id,
                        'value' => '',
            ]));
            }
        }
    }
}
