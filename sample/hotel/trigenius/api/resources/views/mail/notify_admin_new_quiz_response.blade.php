@extends('layouts.email-users')

@section('content')

<h5 style="text-align: center;">Resposta a Questionario</h5>

<div style="margin-top: 25px; margin-bottom: 25px;">
    <x-email-reservation-info-admin :reservation="$reservation" />
</div>

<table style="width: 50%; left: 0; right: 0; margin-left: auto; margin-right: auto;border: 1px solid black; border-collapse: collapse;font-size: 1em;">

    <tr style="border: 1px solid black;">
        <th style="width: 40%">Pergunta</th>
        <th style="text-align: right">Resposta</th>
    </tr>

    @foreach ($reservation->quizResponses as $response)
    <tr style="border: 1px solid black;">
        <td>{{ $response->quizQuestion->question }}</td>
        <td style="text-align: right">{{ $response->answer }}</td>
    </tr>
    @endforeach
</table>


@endsection
