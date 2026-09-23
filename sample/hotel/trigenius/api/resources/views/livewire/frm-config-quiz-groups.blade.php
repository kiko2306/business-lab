<div>

    <div class="from-group">
        <h4><strong class="text-primary">Selecção Questionario</strong></h4>
        <select class="form-select" wire:model='selected_quiz_id' wire:change='getHeaders'>
            @foreach ($quizzes as $quiz)
            <option value="{{ $quiz->id }}">{{ $quiz->name }}</option>
            @endforeach
        </select>
    </div>

    <button class="my-3 btn btn-success" onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-header", @json([$selected_quiz_id]))'>
        <i class="fa-solid fa-person-circle-question"></i> Adicionar Grupo
    </button>

    <table class="table">
        <thead>
            <tr>
                <th scope="col" style="width: 10%">Ordem</th>
                <th scope="col" style="width: 70%">Nome</th>
                <th scope="col" style="width: 10%" class="text-center">Status</th>
                <th scope="col" style="width: 10%" class="text-center">Edição</th>
            </tr>
        </thead>
        <tbody wire:sortable="updateTaskOrder">
            @foreach ($quiz_headers as $qh)
            <tr wire:sortable.item="{{ $qh->id }}" wire:key="task-{{ $qh->id }}">
                <th style="cursor: pointer" wire:sortable.handle>{{ $qh->order }} <i class="fa-solid fa-up-down text-success"></i></th>
                <td>{{ $qh->title }}</td>
                <td class="text-center">
                    @if ($qh->is_active)
                    <i class="fa-solid fa-check text-success"></i>
                    @else
                    <i class="fa-solid fa-times text-danger"></i>
                    @endif
                </td>
                <td class="text-center">
                    <button onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-header", @json([$selected_quiz_id, $qh]))'>
                        <i class="fa-solid fa-pen-to-square text-warning"></i>
                    </button>
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

    {{-- @dump($selected_quiz_id)
    @dump($quiz_headers) --}}

</div>
