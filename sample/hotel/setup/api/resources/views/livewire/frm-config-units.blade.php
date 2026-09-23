<div>
    @foreach ($units as $key => $unit)
    <div class="mb-5">

        <strong class=" h4 text-primary">{{ $unit->name}}</strong> <small class="text-muted"> [{{ $unit->code }}]</small>
        <hr>
        <div class="row">
            {{-- Send quiz --}}
            <div class="col-md-3 col-sm-6">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="send_quiz_{{ $unit->code }}" wire:model='units.{{$key}}.checkout_quiz_is_active'>
                    <label class="form-check-label" for="send_quiz_{{ $unit->code }}">Envia Questionario</label>
                </div>
                @if($units[$key]->checkout_quiz_is_active)
                <select class="mt-3 shadow form-select" wire:model='units.{{ $key }}.checkout_quiz_id' wire:change='change({{ $key }})'>
                    <option value="0" selected>Nenhum</option>
                    @foreach ($quizzes as $quiz )
                    <option value="{{ $quiz->id }}">{{ $quiz->name }}</option>
                    @endforeach
                </select>
                @endif

                @error('units.'.$key.'.checkout_quiz_id') <small class="text-danger">* Deve seleccionar um questionario</small> @enderror
            </div>

            {{-- Send checkin --}}
            <div class="col-md-3 col-sm-6">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="send_checkin_{{ $unit->code }}" wire:model='units.{{$key}}.checkin_is_active'>
                    <label class="form-check-label" for="send_checkin_{{ $unit->code }}">Envia Checkin</label>
                </div>
            </div>

            {{-- Send Birthday --}}
            <div class="col-md-3 col-sm-6">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="send_birthday_{{ $unit->code }}" wire:model='units.{{$key}}.birthday_is_active'>
                    <label class="form-check-label" for="send_birthday_{{ $unit->code }}">Envia Email aniversário</label>
                </div>
            </div>

            {{-- Send Promo --}}
            <div class="col-md-3 col-sm-6">
                <div class="form-check form-switch">
                    <input class="form-check-input" type="checkbox" id="send_promo_{{ $unit->code }}" wire:model='units.{{$key}}.promo_is_active'>
                    <label class="form-check-label" for="send_promo_{{ $unit->code }}">Envia promoções</label>
                </div>
            </div>

        </div>
    </div>
    @endforeach

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
