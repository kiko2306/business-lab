@extends('layouts.quiz')

@section('content')

<div>
    <x-app-logo />
</div>

<div class="container mt-3">
    {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::QUIZ_PAGE_SUBMISSION_TEXT) !!}
</div>

<hr>

<div class="mt-5">
    <x-btn-home-page />
</div>

@endsection
