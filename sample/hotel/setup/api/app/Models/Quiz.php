<?php

namespace App\Models;

use App\Helpers\EventKeysEnum;
use App\Helpers\ReservationStatusKeysEnum;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Quiz extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function headers()
    {
        return $this->hasMany(QuizHeader::class);
    }

    public function unit()
    {
        return $this->hasOne(Unit::class, 'checkout_quiz_id', 'id');
    }

    public static function send()
    {
        info('SendQuizController::send');
        $quiz_event = Event::where('code', EventKeysEnum::QUIZ)->first();

        if (!$quiz_event->is_active) {
            info('The Event Quiz is not Active');

            return;
            //return response()->json(['message' => 'Quiz is not active'], 400);
        }

        if ($quiz_event->hours != Carbon::now()->format('H')) {
            return;
        }

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
    }
}
