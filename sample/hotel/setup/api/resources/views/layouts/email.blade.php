<!DOCTYPE html>
<html style="height: 100%; margin: 0;">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">

    <title>{{ config('app.name', 'HotelUtils') }}</title>

    <link href="{{ asset('css/app.css') }}" rel="stylesheet">

</head>

<body style="height: 100%; margin: 0;">

    <x-email-logo :message="$message" />

    <div style="width: 90%; left:0; right: 0; margin-left: auto; margin-right: auto;">
        @yield('content')
    </div>

    <x-guest-email-footer :reservation="$reservation" />

</body>

</html>
