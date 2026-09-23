<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class QuizResponse extends Model
{
    use HasFactory;

    protected $fillable = [
        'reservation_id',
        'quiz_question_id',
        'answer',
    ];

    public function quizQuestion()
    {
        return $this->hasOne(QuizQuestion::class, 'id', 'quiz_question_id');
    }
}
