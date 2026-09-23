@extends('layouts.quiz')

@section('content')

<x-app-logo />

@livewire('frm-quiz', ['reservation' => $reservation])

@endsection
