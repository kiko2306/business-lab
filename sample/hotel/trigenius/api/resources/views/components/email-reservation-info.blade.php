<div>
    <table style="width: 90%; left: 0; right: 0; margin-left: auto; margin-right: auto;border: 1px solid black; border-collapse: collapse;font-size: 0.9em;">
        <tr>
            <th colspan="2" style="border: 1px solid black; border-collapse: collapse;font-size: 0.9em;">
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::RESERVATION_INFO_EMAIL_TITLE) !!}
            </th>
        </tr>
        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::GUEST) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->guest->name !!} {!! $reservation->guest->last_name !!}
            </td>
        </tr>

        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CHECKIN) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->checkin->format('Y-m-d') !!}
            </td>
        </tr>

        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CHECKOUT) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->checkout->format('Y-m-d') !!}
            </td>
        </tr>

        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::UNIT) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->unit->name !!}
            </td>
        </tr>

        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::OCCUPANTS) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->adults + $reservation->children + $reservation->babies !!}
            </td>
        </tr>

        <tr>
            <td>
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::RESERVATION) !!}
            </td>
            <td style="text-align: right;">
                {!! $reservation->number .'/' . $reservation->line !!}
            </td>
        </tr>

    </table>
</div>
