<div>

    <div class="row">
        <h5 class="text-primary">Email</h5>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $birthday_email_subject_key = App\Helpers\TranslationKeysEnum::BIRTHDAY_MAIL_SUBJECT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($birthday_email_subject_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($birthday_email_subject_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $birthday_email_subject_key }}')">
                Assunto
                @if(!$this->hasAllTranslations($birthday_email_subject_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $checkin_email_text_key = App\Helpers\TranslationKeysEnum::BIRTHDAY_MAIL_TEXT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($checkin_email_text_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($checkin_email_text_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $checkin_email_text_key }}')">
                Texto
                @if(!$this->hasAllTranslations($checkin_email_text_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
    </div>

    @if($selected_translation_key)

    <hr>

    <h5 class="mt-3 text-primary">Original</h5>

    <div class="p-3 shadow card">
        <strong>{!! $default_value !!}</strong>
    </div>

    <hr>

    <div class="w-100">
        <h5 class="text-primary">Traduções</h5>

        @foreach ($translated_values as $key => $tv)

        <div class="w-100">
            <strong>{{ $tv->language->name }}</strong>
            <div class="p-3 mb-3 shadow card">
                <span>{!! $translated_values[$key]->value !!}</span>
                <div class="d-flex justify-content-end">
                    <button class="btn btn-warning"
                        onclick='Livewire.emit("openModal", "{{ $selected_modal }}", @json(["text" => $translated_values[$key]->value, "lang_id" => $translated_values[$key]->language_id]))'>
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

        {{-- @dump($translated_values) --}}

    </div>

</div>
