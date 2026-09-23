<div class="p-3">

    <h5 class="text-primary">Dados do utilizador</h5>
    <div class="mb-3">
        <label for="user_name" class="form-label">Nome</label>
        <input type="text" class="form-control" id="user_name" wire:model='user.name'>
    </div>

    <div class="mb-3">
        <label for="user_email" class="form-label">Email</label>
        <input type="email" class="form-control" id="user_email" wire:model='user.email'>
        <small class="text-danger">@error('user.email') Email já existente! @enderror</small>
    </div>
    <hr>

    <h5 class="text-muted">Acessos</h4>

    @foreach ($units as $unit )
    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                value="{{ $unit->id }}"
                wire:model='selected_units'>

        <label class="form-check-label">
            {{ $unit->name }}
        </label>
    </div>
    @endforeach
    <hr>

    <h5 class="text-muted">Permissões</h4>

    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                value="false"
                wire:model='user.is_admin'>

        <label class="form-check-label">
            Administrador
        </label>
    </div>
    <hr>

    <h5 class="text-muted">Notificações</h4>
    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='user.email_quiz_response'>

        <label class="form-check-label">
            Respostas Questionario
        </label>
    </div>

    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='user.email_check_in_response'>

        <label class="form-check-label">
            Checkin Online
        </label>
    </div>

    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='user.notify_guest_no_mail'>

        <label class="form-check-label">
            Hóspede sem Email
        </label>
    </div>

    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='user.notify_guest_invalid_mail'>

        <label class="form-check-label">
            Hóspede com Email invalido
        </label>
    </div>

    <div class="form-check">
        <input class="form-check-input"
                type="checkbox"
                wire:model='user.notify_service_connection_delay'>

        <label class="form-check-label">
            Serviço Ofline
        </label>
    </div>
    <hr>


    <div class="d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-primary" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

 {{-- {{ var_export($user->attributesToArray()) }} --}}


</div>
