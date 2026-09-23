<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Translation extends Model
{
    use HasFactory;

    protected $connection = 'mysql';

    protected $fillable = [
        'key',
        'value',
        'language_id',
    ];

    public static function boot()
    {
        parent::boot();

        self::creating(function ($model) {
            $model->value = Str::replace('\'', '&#39;', $model->value);
        });

        self::created(function ($model) {
            // ... code here
        });

        self::updating(function ($model) {
            $model->value = Str::replace('\'', '&#39;', $model->value);
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

    public function language()
    {
        return $this->belongsTo(Language::class, 'language_id', 'id');
    }
}
