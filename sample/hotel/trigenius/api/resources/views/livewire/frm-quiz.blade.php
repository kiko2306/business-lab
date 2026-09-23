<div>

    <x-loading />

    @if($text && $step == 0)

    <h3 class="mt-3 text-center text-primary">
        {{ $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::QUIZ_MAIL_SUBJECT) }}
    </h3>

    <div class="text-sm">
        <h6 class="text-center text-primary">
            {{ $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::RESERVATION) }} :
            <br>
            #{{ $reservation->number }} / {{ $reservation->line }} @ {{ $reservation->unit->name }}
        </h6>
        <p class="mb-0 text-center text-muted">
            <small class="mr-3">
                <i class="fa-solid fa-arrow-right-to-bracket"></i>
                {{ $reservation->checkin->format('d/m/Y') }}
            </small>
            <small class="mr-3">
                <i class="fa-solid fa-arrow-right-from-bracket"></i>
                {{ $reservation->checkout->format('d/m/Y') }}
            </small>
        </p>
        <p class="text-center text-muted">
            <small class="mr-3">
                <i class="fa-solid fa-person-shelter"></i>
                {{ $reservation->room_name }}
            </small>
            <small class="mr-3">
                <i class="fa-solid fa-person"></i>
                {{ $reservation->adults }}
            </small>
            <small class="mr-3">
                <i class="fa-solid fa-child"></i>
                {{ $reservation->children }}
            </small>
            <small class="mr-3">
                <i class="fa-solid fa-baby"></i>
                {{ $reservation->babies }}
            </small>
        </p>
    </div>

    <hr>

    <div class="container mt-3">
        {!! $text !!}
    </div>
    @endif

    @if ($step > 0)
    <h1 class="mt-3 text-center text-primary">
        {{ $header_text->translate($language) }}
    </h1>

    <p>
        {{ $question_text->translate($language) }}
    </p>

    @if ($question_type == App\Helpers\QuizQuestionTypeKeyEnum::VALUE)
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step -1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="1">

        <label class="form-check-label" for="flexRadioDefault1">
                <span>1 -</span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
        </label>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step-1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="2">

        <label class="form-check-label" for="flexRadioDefault2">
                <span>2 -</span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
        </label>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step-1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="3">
        <label class="form-check-label" for="flexRadioDefault2">
                <span>3 -</span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
        </label>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step-1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="4">
        <label class="form-check-label" for="flexRadioDefault2">
                <span>4 -</span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
        </label>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step-1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="5">
        <label class="form-check-label" for="flexRadioDefault2">
                <span>5 -</span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
                <span><i class="fa-solid fa-star text-warning"></i></span>
        </label>
    </div>
    <div class="form-check">
        <input class="form-check-input" type="radio" name="quiz_responses.{{ $step-1 }}.answer" wire:model='quiz_responses.{{ $step-1 }}.answer' value="NR">
        <label class="form-check-label" for="flexRadioDefault2">
                <span>NR</span>
        </label>
    </div>
    @endif

    @if ($question_type == App\Helpers\QuizQuestionTypeKeyEnum::TEXT)
    <textarea rows="10" class="form-control" name="quiz_responses.{{ $step-1 }}.answer" wire:model.defer='quiz_responses.{{ $step-1 }}.answer'></textarea>
    @endif

    @endif

    <hr>

    <div class="mt-5 row">
        <div class="col-6 d-flex justify-content-start">
            @if($step > 0)
            <i class="fa-solid fa-circle-chevron-left" style="font-size: 50px" wire:click='prev'></i>
            @endif
        </div>
        <div class="col-6 d-flex justify-content-end">
            @if (!$finish)
            <i class="fa-solid fa-circle-chevron-right" style="font-size: 50px" wire:click='next'></i>
            @else
            <i class="fa-solid fa-cloud-arrow-up" style="font-size: 50px" wire:click='sendQuiz'></i>
            @endif
        </div>
    </div>

    @if($step > 0)
    <div class="text-center text-muted" style="font-size: 0.8em">
        Sections: {{ ($header_n +1) . ' of ' . $quiz_headers->count()}}
    </div>
    <div class="text-center text-muted" style="font-size: 0.8em">
        Questions: {{ ($question_n) .' of '. $quiz_headers[$header_n]->quizQuestion->count()}}
    </div>
    @endif
</div>
