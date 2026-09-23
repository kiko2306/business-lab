<div>

    <div class="row">
        <h5 class="text-primary">Email</h5>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $quiz_email_subject_key = App\Helpers\TranslationKeysEnum::QUIZ_MAIL_SUBJECT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($quiz_email_subject_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($quiz_email_subject_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $quiz_email_subject_key }}')">
                Assunto
                @if(!$this->hasAllTranslations($quiz_email_subject_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $quiz_email_text_key = App\Helpers\TranslationKeysEnum::QUIZ_MAIL_TEXT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($quiz_email_text_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($quiz_email_text_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $quiz_email_text_key }}')">
                Texto
                @if(!$this->hasAllTranslations($quiz_email_text_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $quiz_email_btn_key = App\Helpers\TranslationKeysEnum::BTN_QUIZ;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($quiz_email_btn_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($quiz_email_btn_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $quiz_email_btn_key }}')">
                Botão
                @if(!$this->hasAllTranslations($quiz_email_btn_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
    </div>

    <div class="mt-3 row">
        <h5 class="text-primary">Pagina Web</h5>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $quiz_page_text_key = App\Helpers\TranslationKeysEnum::QUIZ_PAGE_TEXT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($quiz_page_text_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($quiz_page_text_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $quiz_page_text_key }}')">
                Texto
                @if(!$this->hasAllTranslations($quiz_page_text_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>
        <div class="col-md-3 col-sm6" style="height: 75px;">
            @php
            $quiz_page_submission_key = App\Helpers\TranslationKeysEnum::QUIZ_PAGE_SUBMISSION_TEXT;
            @endphp
            <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->hasAllTranslations($quiz_page_submission_key),
                'btn btn-light w-100 h-100'=> $this->hasAllTranslations($quiz_page_submission_key)
                ])
                wire:click="setSelectedTranslationKey('{{ $quiz_page_submission_key }}')">
                Após Submissão
                @if(!$this->hasAllTranslations($quiz_page_submission_key))
                <br> (falta traduções)
                @endif
            </button>
        </div>

        <div class="mt-3 row">
            <h5 class="text-primary">Questionários</h5>
            @foreach ($quizzes as $quiz)
            <div class="col-md-3 col-sm6" style="height: 75px;">
                <button @class([ 'btn btn-light danger w-100 h-100'=> !$this->quizHasAllTranslations($quiz->id),
                    'btn btn-light w-100 h-100'=> $this->quizHasAllTranslations($quiz->id)
                    ])
                    wire:click="showQuiz('{{ $quiz->id }}')">
                    {{ $quiz->name }} [{{ $quiz->id }}]
                    @if(!$this->quizHasAllTranslations($quiz->id))
                    <br> (falta traduções)
                    @endif
                </button>
            </div>
            @endforeach
        </div>

    </div>

    @if($selected_quiz)
    <hr>
    <h5 class="text-primary mt-3">
        Grupo: {{ $selected_quiz->name }}
    </h5>
    <hr>

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Grupo</th>
                <th scope="col">Pergunta</th>
                <th scope="col" style="width: 1%;">Editar</th>
            </tr>
        </thead>
        <tbody>

            @foreach ($selected_quiz->headers as $header)
            <tr class="table-group-header">
                <td class="min">
                    <strong>{{ $header->title }}</strong>
                </td>
                <td></td>
                <td></td>
            </tr>

            @foreach ($countries as $c)
            <tr>
                <td class="min">
                    @if(!$header->hasTranslation($c->language))
                    <span class="text-sm text-danger">[{{ $c->language->code }}] -> </span>
                    @else
                    <span class="text-sm text-success">[{{ $c->language->code }}] -> </span> <span class="text-sm text-muted">{{ $header->translation($c->language)->first()->value}}</span>
                    @endif
                </td>
                <td class="empty"></td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-header-translation", @json(["language_id" => $c->language->id, "header" => $header]))'>
                        <i class="fa-solid fa-pen-to-square text-warning"></i>
                    </button>
                </td>
            </tr>
            @endforeach

            @foreach ($header->quizQuestion as $question)
            <tr class="table-question-header">
                <td></td>
                <td>
                    <strong>{{ $question->question }}</strong>
                </td>
                <td></td>
            </tr>
            @foreach ($countries as $c)
            <tr>
                <td class="empty"></td>
                <td>
                    @if(!$question->hasTranslation($c->language))
                    <span class="text-sm text-danger">[{{ $c->language->code }}] -> </span>
                    @else
                    <span class="text-sm text-success">[{{ $c->language->code }}] -> </span> <span class="text-muted text-sm">{{ $question->translation($c->language)->first()->value}}</span>
                    @endif
                </td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-question-translation", @json(["language_id" => $c->language->id, "question" => $question]))'>
                        <i class="fa-solid fa-pen-to-square text-warning"></i>
                    </button>
                </td>
            </tr>
            @endforeach
            @endforeach

            @endforeach
        </tbody>
    </table>

    @endif

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
