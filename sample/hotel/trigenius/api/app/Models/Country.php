<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Country extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'code',
        'language_id',
    ];

    public function language()
    {
        return $this->hasOne(Language::class, 'id', 'language_id');
    }
}
