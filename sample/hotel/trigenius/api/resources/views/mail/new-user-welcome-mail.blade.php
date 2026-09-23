@extends('layouts.email-users')

@section('content')

<div>
    <div class="d-flex justify-content-center">
        <h3>Bem Vindo ao HotelUtils</h3>
    </div>
</div>

<div style="text-center">
    <p>Foi criado um utilizador para si com os seguintes dados para login:</p>
    Email: {{ $user->email }}
    <br>
    Password (temporaria): 123
    <p style="color:red;">* Deve alterar a sua password na area de gestão no seguinte: <a href="{{ env('APP_URL') }}">endereço</a></p>
</div>

@endsection
