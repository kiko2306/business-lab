<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>{{ config('app.name', 'HotelUtils') }}</title>
</head>

<body style="height: 100%; margin: 0;">

    <div style="margin: 10px;">
        <x-email-logo :message="$message" />

        <div style="width: 90%; left:0; right: 0; margin-left: auto; margin-right: auto;">
            @yield('content')
        </div>
    </div>

</body>

</html>
