@extends('layouts.quiz')

@section('content')

<div>
    <x-app-logo />
</div>

<h3 class="mt-5 mb-5 text-center text-muted">Questionario respondido | Questionnaire answered</h3>

<hr>

<h4 class="text-center text-muted">Só pode responder uma vez ao questionario!</h4>

<h4 class="text-center text-muted">You can only answer the questionnaire once!</h4>

<hr>

<div class="mt-5">
    <x-btn-home-page />
</div>

@endsection
