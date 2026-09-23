<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class QuizQuestionTranslation extends Model
{
    use HasFactory;

    protected $fillable = [
        'quiz_question_id',
        'language_id',
        'value',
    ];
}
