@extends('layouts.email-users')

@section('content')

<h5 style="text-align: center;">Checkin Online efectuado</h5>

<div style="margin-top: 25px;">
    <x-email-reservation-info :reservation="$reservation" />
</div>

@endsection
