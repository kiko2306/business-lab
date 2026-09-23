<div>
    {{-- FRIAS: Ninguem vai ver em telemovel --}}
    <table style="width: 50%; left: 0; right: 0; margin-left: auto; margin-right: auto;border: 1px solid black; border-collapse: collapse;font-size: 0.9em;">
        <tr>
            <th colspan="2" style="border: 1px solid black; border-collapse: collapse;font-size: 0.9em;">
                Dados da Reserva
            </th>
        </tr>
        <tr>
            <td>
                Hóspede
            </td>
            <td style="text-align: right;">
                {!! $reservation->guest->name !!} {!! $reservation->guest->last_name !!}
            </td>
        </tr>

        <tr>
            <td>
                Check-in
            </td>
            <td style="text-align: right;">
                {!! $reservation->checkin->format('Y-m-d') !!}
            </td>
        </tr>

        <tr>
            <td>
                Check-out
            </td>
            <td style="text-align: right;">
                {!! $reservation->checkout->format('Y-m-d') !!}
            </td>
        </tr>

        <tr>
            <td>
                Unidade
            </td>
            <td style="text-align: right;">
                {!! $reservation->unit->name !!}
            </td>
        </tr>

        <tr>
            <td>
                Ocupantes
            </td>
            <td style="text-align: right;">
                {!! $reservation->adults + $reservation->children + $reservation->babies !!}
            </td>
        </tr>

        <tr>
            <td>
                Reserva
            </td>
            <td style="text-align: right;">
                {!! $reservation->number .'/' . $reservation->line !!}
            </td>
        </tr>

    </table>
</div>
