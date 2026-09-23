<div>

    <x-loading />

    <h5 class="text-primary">Filtrar por:</h5>
    <hr>
    {{-- Filter --}}
    <div class="d-flex">
        <div class="mr-3 d-flex align-items-center">
            <label for="filter" class="m-0">Datas:</label>
        </div>
        <div class="d-flex align-items-center" style="min-width: 150px;" wire:ignore>
            <select wire:model="filter" id="filter" class="form-control form-control-sm">
                <option value="today">Hoje</option>
                <option value="yesterday">Ontem</option>
                <option value="last_week">Última Semana</option>
                <option value="last_month">Último Mês</option>
                <option value="last_year">Último Ano</option>
                <option value="all">Todos</option>
            </select>
        </div>

        <div class="ml-3 mr-3 d-flex align-items-center">
            <label for="filter" class="m-0">Unidade:</label>
        </div>
        <div class="d-flex align-items-center" style="min-width: 150px;" wire:ignore>
            <select wire:model="selected_unit" id="filter" class="form-control form-control-sm">
                @foreach ($units as $unit)
                <option value="{{ $unit->id }}">{{ $unit->name }}</option>
                @endforeach
            </select>
        </div>

    </div>

    <hr>

    @foreach ($selected_quiz->headers as $h)
    <div class="mb-3 accordion" id="accordion{{ $h->id }}">
        <div class="accordion-item">
            <h2 class="accordion-header" id="heading{{ $h->id }}">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#collapse{{ $h->id }}" aria-expanded="false" aria-controls="collapse{{ $h->id }}">
                    {{ $h->title }}
                </button>
            </h2>
            <div id="collapse{{ $h->id }}" class="accordion-collapse collapse" aria-labelledby="heading{{ $h->id }}" data-bs-parent="#accordion{{ $h->id }}">
                <div class="accordion-body">

                    <table class="table">
                        <thead>
                            <tr>
                                <th scope="col">Pergunta</th>
                                <th scope="col" class="text-center min">Respostas</th>
                                <th scope="col" class="text-center min">Media</th>
                            </tr>
                        </thead>
                        <tbody>
                            @foreach ($h->quizQuestion as $q)
                            @if($q->type == App\Helpers\QuizQuestionTypeKeyEnum::VALUE)
                            <tr>
                                <td>{{ $q->id }} {{ $q->question }}</td>
                                <td class="text-center min">{{ $this->getTotalAnswers($q)['quizzes'] }} / {{ $quiz_success_filtered->count() }}</td>
                                <td class="text-right min"> {{ $this->getTotalAnswers($q)['value'] }}&nbsp;&#8709;</td>
                            </tr>
                            @endif
                            @endforeach
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    @endforeach


    <p></p>




    {{-- Data Display --}}
    {{-- @if ($quiz_success_filtered)

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Reserva</th>
                <th scope="col">Unidade</th>
                <th scope="col">Nome</th>
                <th scope="col">Checkin</th>
                <th scope="col">Checkout</th>
                <th scope="col" class="text-center">Canal</th>
                <th scope="col" class="text-center">Detalhes</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($quiz_success_filtered as $cki)
            <tr>
                <th scope="row">{{ $cki->number }} / {{ $cki->line }}</th>
                <td>{{ $cki->unit->name }}</td>
                <td>[{{ $cki->guest->code }}] {{ $cki->guest->name }} {{ $cki->guest->last_name }}</td>
                <td>{{ $cki->checkin->format('d-m-Y') }}</td>
                <td>{{ $cki->checkout->format('d-m-Y') }}</td>
                <td class="text-center">{{ $cki->channel }}</td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-dashboard-quiz-success-details", @json([$cki]))'>
                        <i class="fa-brands fa-searchengin text-warning"></i>
                    </button>
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>
    @endif --}}

</div>
