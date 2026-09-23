@extends('layouts.email')

@section('content')

<div style="margin-top: 30px">
    {!! $reservation->guest->getTranslation($translation_key_text) !!}
</div>

<div style="margin-top: 25px;
            width: 90%;
            left:0;
            right: 0;
            margin-left: auto;
            margin-right: auto;">


    <a href="{{ route('quiz.edit', ['uuid' => $reservation->uuid]) }}" style="text-decoration: none">

        <div style="text-align: center;
                    vertical-align: center;
                    width: 250px;
                    line-height: 50px;
                    background-color: #70ABAF;
                    left:0;
                    right: 0;
                    margin-left: auto;
                    margin-right: auto;">

            <span style="color: white"> {{ $reservation->guest->getTranslation($translation_key_btn) }}</span>

        </div>
    </a>

</div>

<div style="margin-top: 25px;">
    <x-email-reservation-info :reservation="$reservation" />
</div>

@endsection
