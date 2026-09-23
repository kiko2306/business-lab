<div>

    <div class="row">
        @foreach ($events as $event)
        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button class="btn btn-light btn-menu" wire:click='onEventChange("{{ $event->code }}")'>
                {{ $event->description }}
            </button>
        </div>
        @endforeach

        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
            <button class="btn btn-light btn-menu" wire:click='onEventChange("OTHER_TEXTS")'>
                Outros textos
            </button>
        </div>
    </div>

    @if ($selected_event)

    <h5 class="my-3 text-center">
        <strong class="p-3 shadow text-info">
            {{ $selected_event_name }}
        </strong>
    </h5>

    <br>

    @if ($selected_event != 'OTHER_TEXTS')
    <div class="container p-3 mb-3 shadow card">
        <h5 class="text-center text-primary">
            <strong>Email de envio ao hóspede</strong>

        </h5>
        <hr>
        <span>
            <strong>Assunto:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "{{ $email_subject_modal }}", @json([$email_subject]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>

        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {{ $email_subject }}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>
        <hr>
        <span>
            <strong>Texto:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "{{ $email_text_modal }}", @json([$email_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>
        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {!! $email_text !!}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

        <hr>

        @if ($selected_event == App\Helpers\EventKeysEnum::CHECKIN || $selected_event == App\Helpers\EventKeysEnum::QUIZ)
        <span>
            <strong>Botão link:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "{{ $btn_text_modal }}", @json([$btn_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>
        </span>
        <div style="text-align: center;
        vertical-align: center;
        width: 250px;
        line-height: 50px;
        background-color: #70ABAF;
        left:0;
        right: 0;
        margin-left: auto;
        margin-right: auto;">

            <span style="color: white"> {{ $btn_text }}</span>

        </div>
        @endif
    </div>

    @else
    <div class="container p-3 mb-3 shadow card">
        <h5 class="text-center text-primary">
            <strong>Protecção de dados</strong>
        </h5>
        <hr>

        <span>
            <strong>Titulo:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "modal-update-data-protection-title", @json([$data_protection_title]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>

        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {{ $data_protection_title }}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

        <hr>

        <span>
            <strong>Texto:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "modal-update-data-protection-text", @json([$data_protection_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>

        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {!! $data_protection_text !!}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

    </div>

    <div class="container p-3 mb-3 shadow card">
        <h5 class="text-center text-primary">
            <strong>Politica Privacidade</strong>
        </h5>
        <hr>

        <span>
            <strong>Titulo:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "modal-update-privacy-title", @json([$privacy_title]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>

        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {{ $privacy_title }}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

        <hr>

        <span>
            <strong>Texto:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "modal-update-privacy-text", @json([$privacy_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>

        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {!! $privacy_text !!}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

    </div>

    @endif

    @if ($selected_event == App\Helpers\EventKeysEnum::CHECKIN || $selected_event == App\Helpers\EventKeysEnum::QUIZ)
    <div class="container p-3 mb-3 shadow card">
        <h5 class="text-center text-primary">
            <strong>Pagina web</strong>
        </h5>
        <hr>

        <span>
            <strong>Texto:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "{{ $page_text_modal }}", @json([$page_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>
        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {!! $page_text !!}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

        <hr>

        <span>
            <strong>Após Submissão:</strong>
            <button class="ml-3" onclick='Livewire.emit("openModal", "{{ $page_submission_text_modal }}", @json([$page_submission_text]))'>
                <i class="fa-solid fa-pen-to-square text-warning"></i>
            </button>
        </span>
        <span>
            <i class="fa-solid fa-quote-left text-success"></i>
            {!! $page_submission_text !!}
            <i class="fa-solid fa-quote-right text-success"></i>
        </span>

    </div>
    @endif

    @endif

    <div class="d-flex justify-content-end">

        <a href="{{ route('configuration.menu') }}" class="mr-3 btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

    </div>

</div>
