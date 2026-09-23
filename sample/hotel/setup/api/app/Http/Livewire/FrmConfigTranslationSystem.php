<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Country;
use App\Models\Language;
use App\Models\Translation;
use Livewire\Component;

class FrmConfigTranslationSystem extends Component
{
    public $declare_checkin_true_data;
    public $declare_checkin_terms_read;
    public $declare_checkin_policy_read_title;
    public $declare_checkin_policy_read_text;
    public $declare_checkin_data_protection_title;
    public $declare_checkin_data_protection_text;
    public $required;
    public $ignore;
    public $reservation_info_email_title;
    public $guest;
    public $checkin;
    public $checkout;
    public $unit;
    public $occupants;
    public $reservation;

    public $countries;
    public $lang_id;
    public $selected_key;
    public $original_value;
    public $translations;

    protected $rules = [
        'countries.*.language_id' => 'required',
    ];

    protected $listeners = [
        'eventChanged' => 'getTranslations',
    ];

    public function mount()
    {
        $this->countries = Country::select('language_id')
            ->where('language_id', '!=', '')
            ->where('language_id', '!=', Language::where('code', 'PT')->first()->id)
            ->distinct()
            ->get();

        $this->lang_id = Language::where('code', 'PT')->first()->id;

        $this->declare_checkin_true_data = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->declare_checkin_terms_read = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_TERMS_READ)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->declare_checkin_policy_read_title = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->declare_checkin_policy_read_text = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->declare_checkin_data_protection_title = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->declare_checkin_data_protection_text = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->required = Translation::where('key', TranslationKeysEnum::REQUIRED)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->ignore = Translation::where('key', TranslationKeysEnum::IGNORE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->reservation_info_email_title = Translation::where('key', TranslationKeysEnum::RESERVATION_INFO_EMAIL_TITLE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->guest = Translation::where('key', TranslationKeysEnum::GUEST)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->checkin = Translation::where('key', TranslationKeysEnum::CHECKIN)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->checkout = Translation::where('key', TranslationKeysEnum::CHECKOUT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->unit = Translation::where('key', TranslationKeysEnum::UNIT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->occupants = Translation::where('key', TranslationKeysEnum::OCCUPANTS)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->reservation = Translation::where('key', TranslationKeysEnum::RESERVATION)
            ->where('language_id', $this->lang_id)
            ->first();
    }

    public function hasAllTranslations($key): bool
    {
        return Translation::where('key', $key)->count() - 1 == $this->countries->count();
    }

    public function setSelectedKey($key)
    {
        $this->selected_key = $key;
        $this->getTranslations();
    }

    public function getTranslations()
    {
        $this->original_value = Translation::where('key', $this->selected_key)
        ->where('language_id', $this->lang_id)
        ->first()->value;

        $this->translations = Translation::whereIn('language_id', $this->countries->pluck('language_id'))
            ->where('key', $this->selected_key)
            ->get();

        foreach ($this->countries as $country) {
            if (!$this->translations->contains('language_id', $country->language_id)) {
                $this->translations->push(new Translation([
                            'key' => $this->selected_key,
                            'language_id' => $country->language_id,
                            'value' => '',
                ]));
            }
        }
    }

    public function render()
    {
        return view('livewire.frm-config-translation-system');
    }
}
