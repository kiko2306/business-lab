@extends('layouts.quiz')

@section('content')

<x-app-logo />

<div class="text-sm">
    <h6 class="text-center text-primary">
        Checkin OnLine : <br> #{{ $reservation->number }} / {{ $reservation->line }} @ {{ $reservation->unit->name }}
    </h6>
    <p class="mb-0 text-center text-muted">
        <small class="mr-3">
            <i class="fa-solid fa-arrow-right-to-bracket"></i>
            {{ $reservation->checkin->format('d/m/Y') }}
        </small>
        <small class="mr-3">
            <i class="fa-solid fa-arrow-right-from-bracket"></i>
            {{ $reservation->checkout->format('d/m/Y') }}
        </small>
    </p>
    <p class="text-center text-muted">
        <small class="mr-3">
            <i class="fa-solid fa-person-shelter"></i>
            {{ $reservation->room_name }}
        </small>
        <small class="mr-3">
            <i class="fa-solid fa-person"></i>
            {{ $reservation->adults }}
        </small>
        <small class="mr-3">
            <i class="fa-solid fa-child"></i>
            {{ $reservation->children }}
        </small>
        <small class="mr-3">
            <i class="fa-solid fa-baby"></i>
            {{ $reservation->babies }}
        </small>
    </p>
</div>

<div class="container">
    <p class="my-3 text-center">
        {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CHECKIN_PAGE_TEXT) !!}
    </p>
</div>

<form method="POST" action="{{ route('checkin.post', ['uuid' => $reservation->uuid]) }}" class="container">

    @csrf

    <div class="accordion accordion-flush" id="accordion_checkin">

        {{-- Main Guest --}}
        @include('checkin.partials.check-in-guest-frm', ['prefix' => 'main_guest', 'title' => $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::MAIN_GUEST) , 'n'=> 0, 'guest' =>
        $reservation->guest])

        {{-- Other adults --}}
        @for ($i = 1; $i < $reservation->adults + $reservation->children + $reservation->babies; $i++)
            @include('checkin.partials.check-in-guest-frm', ['prefix' => 'other_guest', 'title' => $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::OTHER_GUESTS), 'n'=> $i, 'guest'
            => $reservation->extras[$i -1] ?? new \App\Models\Guest()])
            @endfor

    </div>

    @include('checkin.partials.check-in-verify-info')


    @include('checkin.partials.check-in-verify-pp-dpp-read')

    <hr>

    <div class="m-3 d-flex justify-content-end">
        <button class="btn btn-success" type="submit"><i class="fa-solid fa-share-from-square"></i></button>
    </div>

</form>

@endsection
