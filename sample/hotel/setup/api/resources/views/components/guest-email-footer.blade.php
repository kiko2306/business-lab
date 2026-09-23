<div style="background-color: #32292F;
            color: white;
            padding: 15px;
            width: 90%;
            left:0;
            right: 0;
            margin-left: auto;
            margin-right: auto;
            margin-top: 25px;">

    <div style="width: 100%; text-align: center;">
        Redes sociais
    </div>

    <div style="width: 100%; text-align: center;margin-top:10px;">
        <a href="{{ route('unsubscribe.show', ['uuid' => $reservation->guest->uuid]) }}" style="text-decoration: none;color: white;">
            Unsubscribe Emails
        </a>
    </div>

</div>
