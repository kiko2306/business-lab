<div>

    <div class="form-group">
        <label for="unit">Unidade</label>
        <select class="form-select" id="unit" wire:model='selected_unit_id'>
            @foreach ($units as $unit)
            <option value="{{ $unit->id }}">{{ $unit->name }}</option>
            @endforeach
        </select>
    </div>

    <div class="form-group mt-3">
        <label for="cli_name">Nome</label>
        <input type="text" id="cli_name" class="form-control" wire:model='selected_name'>
    </div>

    <div class="form-group mt-3">
        <label for="cli_email">Email</label>
        <input type="email" id="cli_email" class="form-control" wire:model='selected_email'>
    </div>

    <div class="form-group mt-3">
        <label for="country">Pais</label>
        <select id="country" class="form-select" wire:model='selected_country'>
            @foreach ($countries as $country)
            <option value="{{ $country->code }}">{{ $country->name }}</option>
            @endforeach
        </select>
    </div>

    <div class="row">
        <div class="col-6">
            <div class="form-group mt-3">
                <label for="checkin">Checkin</label>
                <input type="date" id="checkin" class="form-control" wire:model='selected_checkin_date'>
            </div>
        </div>
        <div class="col-6">
            <div class="form-group mt-3">
                <label for="checkout">Checkout</label>
                <input type="date" id="checkout" class="form-control" wire:model='selected_checkout_date'>
            </div>
        </div>
    </div>

    <div class="row">
        <div class="col-4">
            <div class="form-group mt-3">
                <label for="adults">Adultos</label>
                <input type="number" id="adults" class="form-control" wire:model='selected_adults'>
            </div>
        </div>
        <div class="col-4">
            <div class="form-group mt-3">
                <label for="children">Crianças</label>
                <input type="number" id="children" class="form-control" wire:model='selected_children'>
            </div>
        </div>
        <div class="col-4">
            <div class="form-group mt-3">
                <label for="babies">Bebés</label>
                <input type="number" id="babies" class="form-control" wire:model='selected_babies'>
            </div>
        </div>
    </div>

    @if ($saved)
    <div class="alert alert-success alert-dismissible fade show mt-3" role="alert">
        <strong>Enviado</strong> com sucesso.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @endif

    <div class="d-flex justify-content-end mt-3">

        <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size mr-3">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <button class="btn btn-success btn-default-size" wire:click='save'>
            <i class="fa-regular fa-floppy-disk"></i>
        </button>

    </div>

</div>
