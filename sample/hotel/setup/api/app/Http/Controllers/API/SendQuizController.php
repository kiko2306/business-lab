<?php

namespace App\Http\Controllers\API;

use App\Helpers\EventKeysEnum;
use App\Helpers\ReservationStatusKeysEnum;
use App\Http\Controllers\Controller;
use App\Models\Event;
use App\Models\Reservation;
use Carbon\Carbon;
use Illuminate\Http\Request;

class SendQuizController extends Controller
{
    public function send(Request $request)
    {
        info('SendQuizController::send');
        $quiz_event = Event::where('code', EventKeysEnum::QUIZ)->first();

        if (!$quiz_event->is_active) {
            info('The Event Quiz is not Active');

            return response()->json(['message' => 'Quiz is not active'], 400);
        }
        info('The event quiz is active');

        $start_date = Carbon::now()->subDay($quiz_event->days_offset)->format('Y-m-d');

        info('Loading reservations with checkout at '.$start_date);

        $reservations = Reservation::where('status', ReservationStatusKeysEnum::CHECKOUT)
        ->where('checkout', '<=', $start_date)
        ->where('quiz_sent', false)
        ->orderBy('id', 'ASC')
        ->get();

        info('Reservations found: '.$reservations->count());

        foreach ($reservations as $reservation) {
            info('Trying to send quiz for reservation "'.$reservation->unit->name.'" '.$reservation->number.' '.$reservation->line);
            $reservation->sendQuizMail();
        }

        info('END');

        return response()->json(['reservations' => $reservations]);
    }
}
