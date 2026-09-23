<div>
    <div class="mb-3">
        <label for="username" class="form-label">Utilizador</label>
        <input type="text" class="form-control" wire:model.defer='user_name' style="text-transform: uppercase">
        @error('user_name') <small class="text-danger">* Campo Obrigatorio</small> @enderror
    </div>

    <div class="mb-3">
        <label for="password" class="form-label">Password</label>
        <input type="password" class="form-control" wire:model.defer='user_password'>
        @error('user_password') <small class="text-danger">* Campo Obrigatorio</small> @enderror
    </div>

    <div class="mb-3">
        <label for="database" class="form-label">Database</label>
        <input type="text" class="form-control" wire:model.defer='database'>
        @error('database') <small class="text-danger">* Campo Obrigatorio</small> @enderror
    </div>

    @if ($saved)
    <div class="alert alert-success alert-dismissible fade show my-3" role="alert">
        <strong>Gravado</strong> com sucesso.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @endif

    <div class="d-flex justify-content-end">

        <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size mr-3">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <button class="btn btn-success btn-default-size" wire:click='save'>
            <i class="fa-regular fa-floppy-disk"></i>
        </button>

    </div>
</div>
