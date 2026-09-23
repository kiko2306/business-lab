<div class="p-3">
    <h5 class="text-primary">Pergunta Questionário</h5>

    <input type="text" class="form-control" wire:model.prevent='value'>

    <div class="d-flex justify-content-end mt-3">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>
</div>
