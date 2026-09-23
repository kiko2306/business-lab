<div class="p-3">

    <h5 class="text-primary">Respostas da reserva: {{ $reservation->number }} / {{ $reservation->line }}</h5>

    <hr>

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Pergunta</th>
                <th scope="col" class="text-center">Resposta</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($reservation->quizResponses as $response)
            <tr>
                <th class="min" scope="row">{{ $response->quizQuestion->question }}</th>
                <td class="text-center">
                    {{ $response->answer }}
                    @if ($response->quizQuestion->type == 'VALUE')
                    <i class="fa-solid fa-star text-warning"></i>
                    @endif
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>

    <div class="mt-3 d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
    </div>

</div>
