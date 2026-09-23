<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ConnLog extends Model
{
    use HasFactory;

    protected $fillable = [
        'last_connection',
        'notified',
    ];
}
