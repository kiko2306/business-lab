<div>

    <div>
        <button class="btn btn-success" onclick='Livewire.emit("openModal", "modal-update-or-create-quiz")'>
            <i class="fa-solid fa-layer-group"></i> Adicionar Questionario
        </button>
    </div>

    <hr>

    <table class="table">
        <thead>
            <tr>
                <th scope="col">#</th>
                <th scope="col">Nome</th>
                <th scope="col">Unidade</th>
                <th scope="col" class="text-center">Status</th>
                <th scope="col" class="text-center">Edição</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($quizzes as $key => $quiz)
            <tr>
                <th scope="row">{{ $key + 1}}</th>
                <td>{{ $quiz->name }}</td>
                <td>{{ $quiz->unit->name ?? 'Não Usado' }}</td>
                <td class="text-center">@if ($quiz->is_active)
                    <i class="fa-solid fa-check text-success"></i>
                    @else
                    <i class="fa-solid fa-times text-danger"></i>
                    @endif
                </td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-update-or-create-quiz", @json([$quiz]))'>
                        <i class="mr-3 fa-solid fa-pen-to-square text-warning"></i>
                    </button>
                    {{-- <button onclick='Livewire.emit("openModal", "modal-confirm-delete-quiz", @json([$quiz]))'>
                        <i class="fa-solid fa-trash text-danger"></i>
                    </button> --}}
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>

    <div class="mt-3 d-flex justify-content-end">
        <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>
    </div>

</div>
