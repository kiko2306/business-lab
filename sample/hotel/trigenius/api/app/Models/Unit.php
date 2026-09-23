<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Unit extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'name',
        'checkout_quiz_id',
        'checkin_is_active',
        'checkout_quiz_is_active',
        'birthday_is_active',
        'promo_is_active',
    ];

    protected $casts = [
        'checkout_quiz_is_active' => 'boolean',
        'checkin_is_active' => 'boolean',
        'birthday_is_active' => 'boolean',
        'promo_is_active' => 'boolean',
    ];

    public function quiz() {
        return $this->hasOne(Quiz::class, 'id', 'checkout_quiz_id');
    }


}
