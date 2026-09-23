<div class="p-3">

    <h5 class="text-muted">Eliminar Utilizador</h5>

    <hr>

    <p>Confirma a eliminação do utilizador {{ $user->name }} ?</p>

    <div class="d-flex justify-content-end">
        <button type="button" class="btn btn-secondary mr-3" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-danger" wire:click='save'>
            <i class="fa-solid fa-check"></i>
        </button>
    </div>
</div>
