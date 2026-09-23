<?php

namespace App\Models;

use App\Helpers\Delay;
use App\Jobs\NewUserWelcomeMailJob;
use App\Jobs\NotifyAdminNewCheckinJob;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Fortify\TwoFactorAuthenticatable;
use Laravel\Jetstream\HasProfilePhoto;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens;
    use HasFactory;
    use HasProfilePhoto;
    use Notifiable;
    use TwoFactorAuthenticatable;

    public static function boot()
    {
        parent::boot();

        self::creating(function ($model) {
        });

        self::created(function ($model) {
            $model->sendWelcomeMail();
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

    /**
     * The attributes that are mass assignable.
     *
     * @var string[]
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'is_admin',
        'email_quiz_response',
        'email_check_in_response',
        'notify_guest_no_mail',
        'notify_guest_invalid_mail',
        'notify_service_connection_delay',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array
     */
    protected $hidden = [
        //'password',
        'remember_token',
        'two_factor_recovery_codes',
        'two_factor_secret',
    ];

    /**
     * The attributes that should be cast.
     *
     * @var array
     */
    protected $casts = [
        'email_verified_at' => 'datetime',
        'is_admin' => 'boolean',
        'email_quiz_response' => 'boolean',
        'email_check_in_response' => 'boolean',
        'notify_guest_no_mail' => 'boolean',
        'notify_guest_invalid_mail' => 'boolean',
        'notify_service_connection_delay' => 'boolean',
    ];

    /**
     * The accessors to append to the model's array form.
     *
     * @var array
     */
    protected $appends = [
        'profile_photo_url',
    ];

    public function units()
    {
        return $this->belongsToMany(Unit::class);
    }

    public function setUnits($ids)
    {
        $this->units()->sync($ids);
    }

    public function sendWelcomeMail()
    {
        NewUserWelcomeMailJob::dispatch($this)
        ->delay(Delay::get());
    }

    public static function notifyNewCheckin(Reservation $reservation)
    {
        NotifyAdminNewCheckinJob::dispatch($reservation)->delay(Delay::get());
    }
}
