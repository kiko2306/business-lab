<div>

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Evento</th>
                <th scope="col">Status</th>
                <th scope="col" style="width: 150px" class="text-center">Dias</th>
            </tr>
        </thead>
        <tbody>

            @foreach ($events as $key => $event)

            <tr>
                <th>{{ $event->description }}</th>
                <td>
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" wire:model='events.{{ $key }}.is_active'>

                        <label class="form-check-label">
                            Activo
                        </label>
                    </div>
                </td>
                <td>
                    <select class="mr-3 form-select form-control-sm d-inline-block" style="width: auto;" id="days" wire:model='events.{{ $key }}.days_offset'>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                        <option value="5">5</option>
                    </select>

                    @if ($event->code == 'CHECKIN' || $event->code == 'BIRTHDAY' || $event->code == 'PROMO')
                        <span>Prévios</span>
                    @elseif ($event->code == 'QUIZ')
                        <span>Após</span>
                    @endif

                </td>
            </tr>

            {{-- <div class="mb-3 row">

                <div class="col-md-4 col-sm-12">
                    <h5>{{ $event->name }} <small class="text-muted">[{{ $event->description }}]</small></h5>
                </div>

                <div class="col-md-4 col-sm-12 d-flex justify-content-md-center">
                    <div class="form-check form-switch">
                        <input class="form-check-input" type="checkbox" wire:model='events.{{ $key }}.is_active'>

                        <label class="form-check-label">
                            Activo
                        </label>
                    </div>
                </div>

                <div class="col-md-4 col-sm-12 d-flex justify-content-md-end">
                    <div class="form-group">

                        <label class="d-inline-block" for="days"><small><strong>Dias (offset):</strong></small></label>

                        <select class="form-select form-control-sm d-inline-block" style="width: auto;" id="days" wire:model='events.{{ $key }}.days_offset'>
                            <option value="1">1</option>
                            <option value="2">2</option>
                            <option value="3">3</option>
                            <option value="4">4</option>
                            <option value="5">5</option>
                        </select>
                    </div>
                </div>
            </div> --}}

            @endforeach

        </tbody>
    </table>

    @if ($saved)
    <div class="my-3 alert alert-success alert-dismissible fade show" role="alert">
        <strong>Gravado</strong> com sucesso.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @endif

    <div class="d-flex justify-content-end">

        <a href="{{ route('configuration.menu') }}" class="mr-3 btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <button class="btn btn-success btn-default-size" wire:click='save'>
            <i class="fa-regular fa-floppy-disk"></i>
        </button>

    </div>

</div>
