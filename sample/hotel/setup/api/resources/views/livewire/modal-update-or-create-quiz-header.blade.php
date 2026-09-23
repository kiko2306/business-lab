<div class="p-3">
    <h5 class="text-primary">Grupo Questionário</h5>
    <div class="form-group">
        <label for="group_name">Nome</label>
        <input type="text" id="group_name" class="form-control" wire:model='quiz_header.title'>
    </div>

    <div class="my-3 form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='quiz_header.is_active'>

        <label class="form-check-label">
           Activo
        </label>
    </div>

    <div class="d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

    {{-- {{ $selected_quiz_id }}
    {{ var_export($quiz_header->attributesToArray()) }} --}}
</div>
