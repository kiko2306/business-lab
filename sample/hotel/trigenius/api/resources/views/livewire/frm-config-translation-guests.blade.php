<div>

    <div class="row">
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::MAIN_GUEST),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::MAIN_GUEST)])
                wire:click="setSelectedKey('{{ $main_guest->key }}')">
                {{ $main_guest->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::OTHER_GUESTS),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::OTHER_GUESTS)])
                wire:click="setSelectedKey('{{ $other_guests->key }}')">
                {{ $other_guests->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::NAME),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::NAME)])
                wire:click="setSelectedKey('{{ $name->key }}')">
                {{ $name->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::LAST_NAME),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::LAST_NAME)])
                wire:click="setSelectedKey('{{ $last_name->key }}')">
                {{ $last_name->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ADDRESS),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ADDRESS)])
                wire:click="setSelectedKey('{{ $address->key }}')">
                {{ $address->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ZIP_CODE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ZIP_CODE)])
                wire:click="setSelectedKey('{{ $zip_code->key }}')">
                {{ $zip_code->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CITY),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CITY)])
                wire:click="setSelectedKey('{{ $city->key }}')">
                {{ $city->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::NATIONALITY),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::NATIONALITY)])
                wire:click="setSelectedKey('{{ $nationality->key }}')">
                {{ $nationality->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::COUNTRY),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::COUNTRY)])
                wire:click="setSelectedKey('{{ $country->key }}')">
                {{ $country->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::PHONE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::PHONE)])
                wire:click="setSelectedKey('{{ $phone->key }}')">
                {{ $phone->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::EMAIL),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::EMAIL)])
                wire:click="setSelectedKey('{{ $email->key }}')">
                {{ $email->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::VAT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::VAT)])
                wire:click="setSelectedKey('{{ $vat->key }}')">
                {{ $vat->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GENDER_MALE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GENDER_MALE)])
                wire:click="setSelectedKey('{{ $gender_male->key }}')">
                {{ $gender_male->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GENDER_FEMALE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GENDER_FEMALE)])
                wire:click="setSelectedKey('{{ $gender_female->key }}')">
                {{ $gender_female->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP)])
                wire:click="setSelectedKey('{{ $age_group->key }}')">
                {{ $age_group->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_ADULT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_ADULT)])
                wire:click="setSelectedKey('{{ $age_group_adult->key }}')">
                {{ $age_group_adult->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_CHILD),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_CHILD)])
                wire:click="setSelectedKey('{{ $age_group_child->key }}')">
                {{ $age_group_child->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_BABY),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::AGE_GROUP_BABY)])
                wire:click="setSelectedKey('{{ $age_group_baby->key }}')">
                {{ $age_group_baby->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE)])
                wire:click="setSelectedKey('{{ $card_type->key }}')">
                {{ $card_type->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_ID),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_ID)])
                wire:click="setSelectedKey('{{ $card_type_id->key }}')">
                {{ $card_type_id->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_PASSPORT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_PASSPORT)])
                wire:click="setSelectedKey('{{ $card_type_passport->key }}')">
                {{ $card_type_passport->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_RESIDENCE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_RESIDENCE)])
                wire:click="setSelectedKey('{{ $card_type_residence->key }}')">
                {{ $card_type_residence->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_DRIVING),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_DRIVING)])
                wire:click="setSelectedKey('{{ $card_type_driving->key }}')">
                {{ $card_type_driving->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_CITIZEN),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_CITIZEN)])
                wire:click="setSelectedKey('{{ $card_type_citizen->key }}')">
                {{ $card_type_citizen->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_REFUGEE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CARD_TYPE_REFUGEE)])
                wire:click="setSelectedKey('{{ $card_type_refugee->key }}')">
                {{ $card_type_refugee->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER)])
                wire:click="setSelectedKey('{{ $id_card_number->key }}')">
                {{ $id_card_number->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER_CONTROL),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER_CONTROL)])
                wire:click="setSelectedKey('{{ $id_card_number_control->key }}')">
                {{ $id_card_number_control->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ISSUED_ON),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ISSUED_ON)])
                wire:click="setSelectedKey('{{ $issue_on->key }}')">
                {{ $issue_on->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::VALID_UNTIL),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::VALID_UNTIL)])
                wire:click="setSelectedKey('{{ $valid_until->key }}')">
                {{ $valid_until->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::PLACE_ISSUE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::PLACE_ISSUE)])
                wire:click="setSelectedKey('{{ $place_issue->key }}')">
                {{ $place_issue->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::COUNTRY_ISSUE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::COUNTRY_ISSUE)])
                wire:click="setSelectedKey('{{ $country_issue->key }}')">
                {{ $country_issue->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ISSUE_BY),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::ISSUE_BY)])
                wire:click="setSelectedKey('{{ $issue_by->key }}')">
                {{ $issue_by->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::BIRTH_PLACE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::BIRTH_PLACE)])
                wire:click="setSelectedKey('{{ $birth_place->key }}')">
                {{ $birth_place->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::BIRTH_DATE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::BIRTH_DATE)])
                wire:click="setSelectedKey('{{ $birth_date->key }}')">
                {{ $birth_date->value }}
            </button>
        </div>
    </div>


    @if ($translations)
    <hr>
    <h5 class="text-primary">Original</h5>
    <div class="card p-3">
        {{ $original_value }}
    </div>
    <hr>
    <h5 class="text-primary">Traduções</h5>
    @foreach ($translations as $key => $tr )

    <div class="w-100">
        <strong>{{ $tr->language->name }}</strong>
        <div class="p-3 mb-3 shadow card">
            <span>{!! $translations[$key]->value !!}</span>
            <div class="d-flex justify-content-end">
                <button class="btn btn-warning"
                    onclick='Livewire.emit("openModal", "modal-update-guests-translation", @json(["key" =>$translations[$key]->key ,"text" => $translations[$key]->value, "lang_id" => $translations[$key]->language_id]))'>
                    <i class="text-white fa-solid fa-pen-to-square"></i>
                </button>
            </div>
        </div>
    </div>

    @endforeach
    @endif

    <div class="mt-3 d-flex justify-content-end">

        <a href="{{ route('translation.menu') }}" class="mr-3 btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

    </div>

</div>
