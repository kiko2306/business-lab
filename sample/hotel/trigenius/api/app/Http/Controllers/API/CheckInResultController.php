<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\CheckIn;
use App\Models\Reservation;
use App\Models\User;
use Illuminate\Http\Request;

class CheckInResultController extends Controller
{
    public function success(Request $request)
    {
        // get check-in by uuid
        $checkIn = Reservation::where('uuid', $request->uuid)->first();

        if (!$checkIn->checkin_success_notification) {
            User::notifyNewCheckin($checkIn);
            $checkIn->guest->notifyCheckinSuccess($checkIn);

            //update checkin notified to true
            $checkIn->checkin_success_notification = true;
            $checkIn->save();
        }

        // return response
        return response()->json([
            'message' => 'Check-in success',
        ]);
    }

    public function fail(Request $request)
    {
        // get check-in by uuid
        $checkIn = Reservation::where('uuid', $request->uuid)->first();

        //TODO: send mail
        //$checkIn->notifyGuestCheckInFail();

        // return response
        return response()->json([
            'message' => 'Error message sent',
        ]);
    }
}
