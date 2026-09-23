<div>
    <x-app-logo />

    <hr>

    <form wire:submit.prevent="save">

        <div class="d-flex justify-content-end">

            <label class="btn btn-warning btn-default-size">
                <i class="mr-3 fa fa-image fa-2x" aria-hidden="true" class="mr-3"></i>
                <input type="file" style="display: none;" wire:model="logo">
                <span>Seleccionar</span>
            </label>
        </div>


        <hr>

        @if ($logo)
        <div class="my-3">
            <img class="center-logo" src="{{ $logo->temporaryUrl() }}">
        </div>
        <hr>
        @endif

        @if (!$config_logo->value)
        <h3 class="text-center">Não tem um logotipo definido!</h3>
        <hr>
        @endif


        <div class="d-flex justify-content-end">

            <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size">
                <i class="fa-solid fa-arrow-left"></i>
            </a>

            @if ($logo)
            <button type="submit" class="ml-3 btn btn-success btn-default-size"><i class="fa-solid fa-cloud-arrow-up"></i></button>
            @endif
        </div>

        @error('logo') <span class="error">{{ $message }}</span> @enderror

    </form>

</div>
