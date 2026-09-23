@extends('layouts.quiz')

@section('content')

<x-app-logo />

<div class="container mt-3">

    <div class="p-3 shadow card">

        <div class="container mt-4">
            {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CHECKIN_PAGE_SUBMISSION_TEXT) !!}
        </div>

    </div>

</div>

<div class="mt-4 text-center">
    <x-btn-home-page />
</div>


@endsection
