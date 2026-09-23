<div>

    <x-loading />

    <h5 class="text-primary">Filtrar por:</h5>
    <hr>
    {{-- Filter --}}
    <div class="d-flex">
        <div class="d-flex align-items-center mr-3">
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

        <div class="d-flex align-items-center mr-3 ml-3">
            <label for="filter" class="m-0">Unidade:</label>
        </div>
        <div class="d-flex align-items-center" style="min-width: 150px;" wire:ignore>
            <select wire:model="selected_unit" id="filter" class="form-control form-control-sm">
                <option value="all">Todas</option>
                @foreach ($units as $unit)
                <option value="{{ $unit->id }}">{{ $unit->name }}</option>
                @endforeach
            </select>
        </div>

        <div class="d-flex align-items-center mr-3 ml-3">
            <label for="filter" class="m-0">Canal:</label>
        </div>
        <div class="d-flex align-items-center" style="min-width: 150px;" wire:ignore>
            <select wire:model="selected_channel" id="filter" class="form-control form-control-sm">
                <option value="all">Todos</option>
                @foreach ($channels as $channel)
                <option value="{{ $channel->channel }}">{{ $channel->channel }}</option>
                @endforeach
            </select>
        </div>

        <div class="d-flex align-items-center mr-3 ml-3">
            <label for="filter" class="m-0 text-muted">N. Correspondências:</label>
        </div>
        <div class="d-flex align-items-center text-muted" style="min-width: 150px;">
            {{ $quiz_sent_filtered->count() ?? 0 }}
        </div>
    </div>

    <hr>

    {{-- Data Display --}}
    @if ($quiz_sent_filtered)

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Reserva</th>
                <th scope="col">Unidade</th>
                <th scope="col">Nome</th>
                <th scope="col">Checkin</th>
                <th scope="col">Checkout</th>
                <th scope="col" class="text-center">Canal</th>
                <th scope="col" class="text-center">C/ Resposta</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($quiz_sent_filtered as $cki)
            <tr>
                <th scope="row">{{ $cki->number }} / {{ $cki->line }}</th>
                <td>{{ $cki->unit->name }}</td>
                <td>[{{ $cki->guest->code }}] {{ $cki->guest->name }} {{ $cki->guest->last_name }}</td>
                <td>{{ $cki->checkin->format('d-m-Y') }}</td>
                <td>{{ $cki->checkout->format('d-m-Y') }}</td>
                <td class="text-center">{{ $cki->channel }}</td>
                <td class="text-center">
                    @if ($cki->quiz_response)
                    <i class="fa-solid fa-check text-success"></i>
                    @else
                    <i class="fa-solid fa-times text-danger"></i>
                    @endif
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>
    @endif

</div>
