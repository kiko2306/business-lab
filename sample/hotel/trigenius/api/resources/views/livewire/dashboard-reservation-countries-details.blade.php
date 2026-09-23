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
    </div>

    <hr>

    {{-- Data Display --}}
    @if ($reservation_filtered)

    <table class="table">
        <thead>
            <tr>
                <th scope="col" class="w-100">Pais</th>
                <th scope="col">N.&nbsp;Reservas</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($countries_count as $key => $c)
            <tr>
                <th scope="row">{{ $key }} </th>
                <td class="text-center">{{ $c }}</td>
            </tr>
            @endforeach
        </tbody>
    </table>

    @endif

</div>
