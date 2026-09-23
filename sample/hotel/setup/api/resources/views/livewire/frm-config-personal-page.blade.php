<div>
    <div class="mb-3">
        <label for="personal_page_url" class="form-label">URL</label>
        <input type="url" class="form-control" id="personal_page_url" placeholder="http://mywebsite.com" wire:model.defer='url'>
    </div>

    @if ($saved)
    <div class="my-3 alert alert-success alert-dismissible fade show" role="alert">
        <strong>Gravado</strong> com sucesso.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @endif

    @error('url')
    <div class="my-3 alert alert-danger alert-dismissible fade show" role="alert">
        <strong>Erro</strong> Deve indicar um url valido.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @enderror

    <div class="d-flex justify-content-end">

        <a href="{{ route('configuration.menu') }}" class="mr-3 btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <button type="button" wire:click='save' class="btn btn-success btn-default-size">
            <i class="fa-regular fa-floppy-disk"></i>
        </button>

    </div>
</div>
