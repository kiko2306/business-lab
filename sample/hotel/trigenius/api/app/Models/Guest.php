<?php

namespace App\Models;

use App\Helpers\Delay;
use App\Helpers\VarReplace;
use App\Jobs\NotifyGuestCheckinSuccessJob;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Guest extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'name',
        'last_name',
        'address1',
        'address2',
        'address3',
        'zip_code',
        'city',
        'country',
        'phone',
        'email',
        'nif',
        'gender',
        'doc',
        'doc_number',
        'doc_number_id_control',
        'doc_date',
        'doc_valid',
        'doc_local',
        'doc_country',
        'doc_by',
        'birth_local',
        'birth_date',
        'nationality',
        'mailable',
        'has_changes',
    ];

    protected $casts = [
        'doc_date' => 'date',
        'doc_valid' => 'date',
        'birth_date' => 'date',
        'mailable' => 'boolean',
        'has_changes' => 'boolean',
    ];

    public static function boot()
    {
        parent::boot();

        self::creating(function ($model) {
            $model->uuid = Str::uuid();
            if ($model->country) {
                $model->country = strtoupper($model->country);
            }

            if ($model->nationality) {
                $model->nationality = strtoupper($model->nationality);
            }
        });

        self::created(function ($model) {
            // ... code here
        });

        self::updating(function ($model) {
            if ($model->country) {
                $model->country = strtoupper($model->country);
            }

            if ($model->nationality) {
                $model->nationality = strtoupper($model->nationality);
            }
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

    public function locale()
    {
        return $this->hasOne(Country::class, 'code', 'nationality');
    }

    public function getTranslation($key)
    {
        // default text
        $text = null;
        $language = $this->getLanguage();

        $translation = Translation::where('key', $key)
            ->where('language_id', $language->id)->first();

        if ($translation) {
            $text = $translation->value;
        } else {
            // Default
            $language_default = Language::where('default', true)->first();

            $translation = Translation::where('key', $key)
            ->where('language_id', $language_default->id)->first();

            if ($translation) {
                $text = $translation->value;
            } else {
                // PT
                $language_fall_back = Language::where('code', 'PT')->first();
                $translation = Translation::where('key', $key)
                 ->where('language_id', $language_fall_back->id)->first();

                if ($translation) {
                    $text = $translation->value;
                } else {
                    $text = '';
                }
            }
        }

        $text = VarReplace::replace($text, $this);

        return $text;
    }

    public function getLanguage(): Language
    {
        // get default language
        // Default
        $language_default = Language::where('default', true)->first();
        // PT
        $language_fall_back = Language::where('code', 'PT')->first();

        $ret_language = null;

        // Check if guest has nationality
        if ($this->nationality) {
            $ret_language = $this->locale->language ? $this->locale->language : null;
        }

        if ($ret_language) {
            return $ret_language;
        }

        if ($language_default) {
            return $language_default;
        } else {
            return $language_fall_back;
        }
    }

    public function notifyCheckinSuccess(Reservation $reservation)
    {
        NotifyGuestCheckinSuccessJob::dispatch($reservation)->delay(Delay::get());
    }
}
