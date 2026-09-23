<div>

    <div class="from-group">
        <h4><strong class="text-primary">Selecção Questionario</strong></h4>
        <select class="form-select" wire:model='selected_quiz_id' wire:change='getHeaders'>
            @foreach ($quizzes as $quiz)
            <option value="{{ $quiz->id }}">{{ $quiz->name }}</option>
            @endforeach
        </select>
    </div>

    <hr>

    <div class="container">

        <span class="my-3"><strong>Grupos</strong>
            <small>
                <span class="ml-3 text-muted">Legenda:</span>
                <i class="ml-3 fa-solid fa-check text-success"></i> - Activo
                <i class="ml-3 fa-solid fa-times text-danger"></i> - Inactivo
                <i class="ml-3 fa-solid fa-star text-warning"></i> - Tipo Valor
                <i class="ml-3 fa-solid fa-align-justify"></i> - Tipo Texto
            </small>
        </span>

        <div>
            @foreach ($quiz_headers as $quiz_header)
            <div class="p-3 my-3 shadow card">
                <h5>
                    <strong class="text-primary">
                        @if ($quiz_header->is_active)
                        {{ $quiz_header->title }}
                        <i class="ml-3 fa-solid fa-check text-success"></i>
                        @else
                        <span class="text-danger"> {{ $quiz_header->title }} </span>
                        <i class="ml-3 fa-solid fa-times text-danger"></i>
                        @endif
                    </strong>

                    <button class="btn btn-sm btn-success float-end" onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-question", @json([$quiz_header->id]))'>
                        <i class="fa-solid fa-plus"></i> Adicionar questão
                    </button>

                </h5>
                <hr>
                <table class="table">
                    <thead>
                        <tr>
                            <th scope="col" style="width: 15%">Ordem</th>
                            <th scope="col" style="width: 60%">Nome</th>
                            <th scope="col" style="width: 20%">Status</th>
                            <th scope="col" style="width: 5%">Edição</th>
                        </tr>
                    </thead>
                    <tbody wire:sortable="updateTaskOrder" wire:sortable-group="updateTaskOrder">
                        @foreach ($quiz_header->quizQuestion as $question)
                        <tr wire:sortable.item="{{ $question->id }}" wire:key="task-{{ $question->id }}">
                            <th style="cursor: pointer" wire:sortable.handle>{{ $question->order }} <i class="fa-solid fa-up-down text-success"></i></th>
                            <td>{{ $question->question }}</td>
                            <td>
                                @if($question->type == 'VALUE')<i class="mr-3 fa-solid fa-star text-warning"></i> @else <i class="mr-3 fa-solid fa-align-justify"></i> @endif</small>
                                @if ($question->is_active) <i class="fa-solid fa-check text-success"></i> @else <i class="fa-solid fa-times text-danger"></i> @endif
                            </td>
                            <td class="d-flex justify-content-end align-items-center">
                                <button onclick='Livewire.emit("openModal", "modal-update-or-create-quiz-question", @json([$quiz_header->id, $question]))'>
                                    <i class="mr-3 fa-solid fa-pen-to-square text-warning"></i>
                                </button>
                            </td>
                        </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>


            @endforeach
        </div>

    </div>

    <div class="mt-3 d-flex justify-content-end">
        <a href="{{ route('configuration.menu') }}" class="btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>
    </div>

</div>
