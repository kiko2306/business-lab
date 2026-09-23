<?php

namespace App\Helpers;

class QuizQuestionTypeKeyEnum
{
    const TEXT = 'TEXT';
    const VALUE = 'VALUE';

    public static function getRandomValue()
    {
        $values = [
            self::TEXT,
            self::VALUE,
        ];
        return $values[array_rand($values)];
    }
}

