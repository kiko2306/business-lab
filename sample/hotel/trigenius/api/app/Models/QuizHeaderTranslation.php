<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class QuizHeaderTranslation extends Model
{
    use HasFactory;

    protected $fillable = [
        'quiz_header_id',
        'language_id',
        'value',
    ];

    public function quizHeader()
    {
        return $this->belongsTo(QuizHeader::class);
    }
}
