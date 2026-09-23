<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Event extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'name',
        'description',
        'hours',
        'days_offset',
        'is_active',
    ];

    protected $casts = [
        'hours' => 'integer',
        'days_offset' => 'integer',
        'is_active' => 'boolean',
    ];
}
