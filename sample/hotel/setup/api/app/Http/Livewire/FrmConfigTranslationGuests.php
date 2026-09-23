<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Country;
use App\Models\Language;
use App\Models\Translation;
use Livewire\Component;

class FrmConfigTranslationGuests extends Component
{
    public $main_guest;
    public $other_guests;
    public $name;
    public $last_name;
    public $address;
    public $zip_code;
    public $city;
    public $nationality;
    public $country;
    public $phone;
    public $email;
    public $vat;
    public $gender_male;
    public $gender_female;
    public $age_group;
    public $age_group_adult;
    public $age_group_child;
    public $age_group_baby;
    public $card_type;
    public $card_type_id;
    public $card_type_passport;
    public $card_type_residence;
    public $card_type_driving;
    public $card_type_citizen;
    public $card_type_refugee;
    public $id_card_number;
    public $id_card_number_control;
    public $issue_on;
    public $valid_until;
    public $place_issue;
    public $country_issue;
    public $issue_by;
    public $birth_place;
    public $birth_date;

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

        $this->main_guest = Translation::where('key', TranslationKeysEnum::MAIN_GUEST)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->other_guests = Translation::where('key', TranslationKeysEnum::OTHER_GUESTS)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->name = Translation::where('key', TranslationKeysEnum::NAME)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->last_name = Translation::where('key', TranslationKeysEnum::LAST_NAME)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->address = Translation::where('key', TranslationKeysEnum::ADDRESS)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->zip_code = Translation::where('key', TranslationKeysEnum::ZIP_CODE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->city = Translation::where('key', TranslationKeysEnum::CITY)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->nationality = Translation::where('key', TranslationKeysEnum::NATIONALITY)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->country = Translation::where('key', TranslationKeysEnum::COUNTRY)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->phone = Translation::where('key', TranslationKeysEnum::PHONE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->email = Translation::where('key', TranslationKeysEnum::EMAIL)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->vat = Translation::where('key', TranslationKeysEnum::VAT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->gender_male = Translation::where('key', TranslationKeysEnum::GENDER_MALE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->gender_female = Translation::where('key', TranslationKeysEnum::GENDER_FEMALE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->age_group = Translation::where('key', TranslationKeysEnum::AGE_GROUP)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->age_group_adult = Translation::where('key', TranslationKeysEnum::AGE_GROUP_ADULT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->age_group_child = Translation::where('key', TranslationKeysEnum::AGE_GROUP_CHILD)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->age_group_baby = Translation::where('key', TranslationKeysEnum::AGE_GROUP_BABY)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type = Translation::where('key', TranslationKeysEnum::CARD_TYPE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_id = Translation::where('key', TranslationKeysEnum::CARD_TYPE_ID)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_passport = Translation::where('key', TranslationKeysEnum::CARD_TYPE_PASSPORT)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_residence = Translation::where('key', TranslationKeysEnum::CARD_TYPE_RESIDENCE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_driving = Translation::where('key', TranslationKeysEnum::CARD_TYPE_DRIVING)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_citizen = Translation::where('key', TranslationKeysEnum::CARD_TYPE_CITIZEN)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->card_type_refugee = Translation::where('key', TranslationKeysEnum::CARD_TYPE_REFUGEE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->id_card_number = Translation::where('key', TranslationKeysEnum::ID_CARD_NUMBER)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->id_card_number_control = Translation::where('key', TranslationKeysEnum::ID_CARD_NUMBER_CONTROL)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->issue_on = Translation::where('key', TranslationKeysEnum::ISSUED_ON)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->valid_until = Translation::where('key', TranslationKeysEnum::VALID_UNTIL)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->place_issue = Translation::where('key', TranslationKeysEnum::PLACE_ISSUE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->country_issue = Translation::where('key', TranslationKeysEnum::COUNTRY_ISSUE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->issue_by = Translation::where('key', TranslationKeysEnum::ISSUE_BY)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->birth_place = Translation::where('key', TranslationKeysEnum::BIRTH_PLACE)
            ->where('language_id', $this->lang_id)
            ->first();

        $this->birth_date = Translation::where('key', TranslationKeysEnum::BIRTH_DATE)
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
        return view('livewire.frm-config-translation-guests');
    }
}
