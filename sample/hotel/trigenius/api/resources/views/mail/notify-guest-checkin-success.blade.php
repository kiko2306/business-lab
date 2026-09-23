@extends('layouts.email-users')

@section('content')

{{-- TODO: Criar tradução cabeçalho do email; --}}
<h5 style="text-align: center;"> {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CHECKIN) !!} OK</h5>

<div style="margin-top: 25px;">
    <x-email-reservation-info :reservation="$reservation" />
</div>

@endsection
