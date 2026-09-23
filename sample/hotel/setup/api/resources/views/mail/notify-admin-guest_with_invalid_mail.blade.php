@extends('layouts.email-users')

@section('content')

<h5 style="text-align: center;">Hospede com email invalido</h5>
<h6 style="text-align: center"> {{ $reservation->guest->email }} não é um email valido! </h6>

<div style="margin-top: 25px;">
    <x-email-reservation-info :reservation="$reservation" />
</div>

@endsection
