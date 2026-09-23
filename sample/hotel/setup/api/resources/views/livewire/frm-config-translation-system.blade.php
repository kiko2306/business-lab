<div>

    <div wire:loading>
        <div class="loading">Loading&#8230;</div>
    </div>

    <div class="row">
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA)])
                wire:click="setSelectedKey('{{ $declare_checkin_true_data->key }}')">
                Checkin Declaração dados verdadeiros
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TERMS_READ),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TERMS_READ)])
                wire:click="setSelectedKey('{{ $declare_checkin_terms_read->key }}')">
                {{ $declare_checkin_terms_read->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE)])
                wire:click="setSelectedKey('{{ $declare_checkin_policy_read_title->key }}')">
                Titulo politica de privacidade
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT)])
                wire:click="setSelectedKey('{{ $declare_checkin_policy_read_text->key }}')">
                Texto politica de privacidade
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE)])
                wire:click="setSelectedKey('{{ $declare_checkin_data_protection_title->key }}')">
                Titulo protecção de dados
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT)])
                wire:click="setSelectedKey('{{ $declare_checkin_data_protection_text->key }}')">
                Texto protecção de dados
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::REQUIRED),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::REQUIRED)])
                wire:click="setSelectedKey('{{ $required->key }}')">
                {{ $required->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::IGNORE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::IGNORE)])
                wire:click="setSelectedKey('{{ $ignore->key }}')">
                {{ $ignore->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::RESERVATION_INFO_EMAIL_TITLE),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::RESERVATION_INFO_EMAIL_TITLE)])
                wire:click="setSelectedKey('{{ $reservation_info_email_title->key }}')">
                {{ $reservation_info_email_title->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GUEST),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::GUEST)])
                wire:click="setSelectedKey('{{ $guest->key }}')">
                {{ $guest->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CHECKIN),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CHECKIN)])
                wire:click="setSelectedKey('{{ $checkin->key }}')">
                {{ $checkin->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CHECKOUT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::CHECKOUT)])
                wire:click="setSelectedKey('{{ $checkout->key }}')">
                {{ $checkout->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::UNIT),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::UNIT)])
                wire:click="setSelectedKey('{{ $unit->key }}')">
                {{ $unit->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::OCCUPANTS),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::OCCUPANTS)])
                wire:click="setSelectedKey('{{ $occupants->key }}')">
                {{ $occupants->value }}
            </button>
        </div>
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button @class([ 'btn btn-light w-100'=> $this->hasAllTranslations(App\Helpers\TranslationKeysEnum::RESERVATION),
                'btn btn-light danger w-100'=> !$this->hasAllTranslations(App\Helpers\TranslationKeysEnum::RESERVATION)])
                wire:click="setSelectedKey('{{ $reservation->key }}')">
                {{ $reservation->value }}
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
        <strong>{{  $tr->language->name }}</strong>
        <div class="p-3 mb-3 shadow card">
            <span>{!! strip_tags($translations[$key]->value) !!}</span>
            <div class="d-flex justify-content-end">
                <button class="btn btn-warning"
                    onclick='Livewire.emit("openModal", "modal-update-guests-translation", @json(["key" => $translations[$key]->key ,"text" => $translations[$key]->value, "lang_id" => $translations[$key]->language_id]))'>
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
