<div class="p-3">
    <h5 class="text-primary">Pergunta Questionário</h5>
    <div class="form-group">
        <label for="question">Questão</label>
        <input type="text" class="form-control" id="question" wire:model='quiz_question.question'>
    </div>

    <div class="form-group">
        <label for="type">Tipo</label>
        <select class="form-select" id="type" wire:model='quiz_question.type' @if($quiz_question->id) disabled @endif>
            <option value="VALUE">Valor</option>
            <option value="TEXT">Texto</option>
        </select>
    </div>

    <div class="my-3 form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='quiz_question.is_active'>

        <label class="form-check-label">
           Activo
        </label>
    </div>

    <div class="mt-3 d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

</div>
