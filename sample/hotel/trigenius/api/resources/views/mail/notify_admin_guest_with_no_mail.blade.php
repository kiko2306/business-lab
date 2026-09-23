@extends('layouts.email-users')

@section('content')

<h6 style="text-align: center;">Hospede sem email</h6>

<div style="margin-top: 25px;">
    <x-email-reservation-info :reservation="$reservation" />
</div>

@endsection
