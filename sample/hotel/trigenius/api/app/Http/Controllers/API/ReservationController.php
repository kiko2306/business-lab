<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Guest;
use App\Models\GuestExtra;
use App\Models\Reservation;
use App\Models\Unit;
use Illuminate\Http\Request;

class ReservationController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function index()
    {
        $checkin = Reservation::where('checkin_success', true)
            ->where('checkin_success_notification', false)
            ->with('unit')
            ->with('guest')
            ->with('extras')
            ->get();

        return response()->json($checkin);
    }

    /**
     * Store a newly created resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
        $this->validate($request, [
            '*.unit.code' => 'required', // get id
            '*.number' => 'required|integer',
            '*.line' => 'required|integer',
        ]);

        foreach ($request->all() as $reservation) {
            // TODO: validar se guest actualizou email (Para update)

            $new_reservation = Reservation::updateOrCreate(
                [
                    'unit_id' => Unit::where('code', $reservation['unit']['code'])->first()->id,
                    'number' => $reservation['number'],
                    'line' => $reservation['line'],
                ],
                [
                    'unit_id' => Unit::where('code', $reservation['unit']['code'])->first()->id,
                    'number' => $reservation['number'],
                    'line' => $reservation['line'],
                    'guest_id' => Guest::where('code', $reservation['guest']['code'])->first() ? Guest::where('code', $reservation['guest']['code'])->first()->id : null,
                    'room_code' => $reservation['room_code'],
                    'room_name' => $reservation['room_name'],
                    'adults' => $reservation['adults'],
                    'children' => $reservation['children'],
                    'babies' => $reservation['babies'],
                    'checkin' => $reservation['checkin'],
                    'checkout' => $reservation['checkout'],
                    'status' => $reservation['status'],
                    'channel' => $reservation['channel'],
                    'error_no_mail' => false,
                    'error_invalid_mail' => false,
            ]
            );

            if (count($reservation['extras']) > 0) {
                GuestExtra::add($new_reservation->id, $reservation['extras']);
            }
        }
    }
}
