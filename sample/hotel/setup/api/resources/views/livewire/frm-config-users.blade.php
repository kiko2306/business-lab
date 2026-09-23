<div>

    <div>
        <button class="btn btn-success" onclick='Livewire.emit("openModal", "modal-update-or-create-user")'>
            <i class="mr-3 fa-solid fa-user-plus"></i> Adicionar Utilizador
        </button>
    </div>

    <hr>

    <table class="table">
        <thead>
            <tr>
                <th scope="col">#</th>
                <th scope="col">Nome</th>
                <th scope="col">Email</th>
                <th scope="col" style="width: 150px;" class="text-center">Acções</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($users as $key => $user)
            <tr>
                <th scope="row">{{ $key + 1}}</th>
                <td>{{ $user->name }}</td>
                <td>{{ $user->email }}</td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-update-or-create-user", @json([$user]))'>
                        <i class="mr-3 fa-solid fa-pen-to-square text-warning"></i>
                    </button>
                    <button onclick='Livewire.emit("openModal", "modal-confirm-delete-user", @json([$user]))'>
                        <i class="ml-3 fa-solid fa-trash text-danger"></i>
                    </button>
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>

    {{ $users->links() }}

    <div class="mt-3 d-flex justify-content-end">
        <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>
    </div>
</div>
