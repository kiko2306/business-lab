<?php

namespace App\Models;

use App\Helpers\Delay;
use App\Helpers\ReservationStatusKeysEnum;
use App\Jobs\NotifyAdminGuestWithInvalidMailJob;
use App\Jobs\NotifyAdminGuestWithNoMailJob;
use App\Jobs\SendCheckinMailJob;
use App\Jobs\SendQuizMailJob;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class Reservation extends Model
{
    use HasFactory;

    protected $fillable = [
       'unit_id',
       'number',
       'line',
       'guest_id',
       'room_code',
       'room_name',
       'adults',
       'children',
       'babies',
       'checkin',
       'checkout',
       'checkin_sent',
       'checkin_success',
       'checkin_success_notification',
       'quiz_sent',
       'quiz_response',
       'error_no_email',
       'error_invalid_email',
       'status',
       'channel',
    ];

    protected $casts = [
        'checkin' => 'date:Y-m-d',
        'checkout' => 'date:Y-m-d',
        'checkin_sent' => 'boolean',
        'checkin_success' => 'boolean',
        'checkin_success_notification' => 'boolean',
        'quiz_sent' => 'boolean',
        'quiz_response' => 'boolean',
        'error_no_email' => 'boolean',
        'error_invalid_email' => 'boolean',
    ];

    public static function boot()
    {
        parent::boot();

        self::creating(function ($model) {
            $model->uuid = Str::uuid();
        });

        self::created(function ($model) {
            // ... code here
        });

        self::updating(function ($model) {
            // ... code here
        });

        self::updated(function ($model) {
            // ... code here
        });

        self::deleting(function ($model) {
            // ... code here
        });

        self::deleted(function ($model) {
            // ... code here
        });
    }

    public function unit()
    {
        return $this->belongsTo(Unit::class);
    }

    public function guest()
    {
        return $this->belongsTo(Guest::class);
    }

    public function extras()
    {
        return $this->hasMany(GuestExtra::class, 'reservation_id', 'id');
    }

    public function getStatusDescription($value)
    {
        return ReservationStatusKeysEnum::getKey($value);
    }

    public function canSendMail()
    {
        return $this->hasMail() && $this->hasValidEmail();
    }

    public function hasMail()
    {
        $validator = Validator::make($this->guest->toArray(), [
            'email' => 'required',
        ]);

        if ($validator->fails()) {
            if ($this->error_no_email) {
                return;
            }

            $this->error_no_email = true;
            $this->save();

            NotifyAdminGuestWithNoMailJob::dispatch($this)
                ->delay(Delay::get());

            return false;
        } else {
            $this->error_no_email = false;
            $this->save();
        }

        return true;
    }

    public function hasValidEmail()
    {
        $validator = Validator::make($this->guest->toArray(), [
            'email' => 'required|email',
        ]);

        if ($validator->fails()) {
            if ($this->error_invalid_email) {
                return;
            }
            $this->error_invalid_email = true;
            $this->save();

            NotifyAdminGuestWithInvalidMailJob::dispatch($this)
                    ->delay(Delay::get());

            return false;
        } else {
            $this->error_invalid_email = false;
            $this->save();
        }

        return true;
    }

    public function quizResponses()
    {
        return $this->hasMany(QuizResponse::class);
    }

    public static function sendCheckin($days_offset)
    {
        $date = Carbon::now()->addDays($days_offset)->format('Y-m-d');

        $checkinLst = Reservation::where('checkin', $date)
        ->where('checkin_sent', false)
        ->where('checkin_success', false)
        ->where('status', ReservationStatusKeysEnum::RESERVED)
        ->get();

        foreach ($checkinLst as $res) {
            Log::debug($res);

            if (!$res->unit->checkin_is_active) {
                Log::debug('CHECKIN_NOT_SENT: Unit checkin is disabled');

                continue;
            }

            if (!$res->guest) {
                Log::debug('CHECKIN_NOT_SENT: reservation has no guest');

                continue;
            }

            if ($res->guest->mailable && $res->canSendMail()) {
                SendCheckinMailJob::dispatch($res)->delay(Delay::get());

                $res->checkin_sent = true;
                $res->save();

                Log::debug('Sent');
            } else {
                Log::debug('Can\'t send mail.');
            }
        }
    }

    public static function sendQuiz($days_offset)
    {
        $start_date = Carbon::now()->subDay($days_offset)->format('Y-m-d');

        Log::debug('start date '.$start_date);

        $reservations = Reservation::where('status', ReservationStatusKeysEnum::CHECKOUT)
        ->where('checkout', '<=', $start_date)
        ->where('quiz_sent', false)
        ->orderBy('id', 'ASC')
        ->get();

        foreach ($reservations as $reservation) {
            $reservation->sendQuizMail();
        }
    }

    public function sendQuizMail()
    {
        if (!$this->unit->checkout_quiz_id) {
            info('QUIZ_NOT_SENT: Unit has no quiz');

            return;
        }

        if (!$this->unit->checkout_quiz_is_active) {
            info('QUIZ_NOT_SENT: Unit Checkout quiz is disabled');

            return;
        }

        if (!$this->guest) {
            info('QUIZ_NOT_SENT: reservation has no guest');

            return;
        }

        if (!$this->unit->quiz->is_active) {
            info('QUIZ_NOT_SENT: The quiz is not active');
        }

        if ($this->guest->mailable && $this->canSendMail()) {
            SendQuizMailJob::dispatch($this)
                ->delay(Delay::get());

            $this->quiz_sent = true;
            $this->save();
        }
    }
}
