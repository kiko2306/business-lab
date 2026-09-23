<div class="p-3">

    <h5 class="text-primary">Questionário</h5>
    <div class="mb-3">
        <label for="quiz_name" class="form-label">Nome</label>
        <input type="text" class="form-control" id="quiz_name" wire:model='quiz.name'>
    </div>

    <div class="form-check">
        <input class="form-check-input" type="checkbox" wire:model='quiz.is_active'>

        <label class="form-check-label">
            Activo
        </label>
    </div>

    <div class="mt-3 form-group">
        <label>Unidade</label>
        <select class="form-select" wire:model='selected_unit_id'>
            @foreach ($units as $unit)
            <option value="{{ $unit->id }}">{{ $unit->name }}</option>
            @endforeach
        </select>
    </div>

    <div class="mt-3 d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

    {{-- {{ var_export($quiz->attributesToArray()) }}
    <br>
    {{ var_export($quiz->exists) }}
    <br>
    {{ var_export($selected_unit_id) }} --}}


</div>
