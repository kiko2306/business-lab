<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

class QuizQuestion extends Model
{
    use HasFactory;

    protected $fillable = [
        'quiz_header_id',
        'question',
        'type',
        'order',
        'is_active',
    ];

    protected $casts = [
        'quiz_header_id' => 'integer',
        'order' => 'integer',
        'is_active' => 'boolean',
    ];

    public function quizHeader()
    {
        return $this->belongsTo(QuizHeader::class, 'id', 'quiz_header_id');
    }

    public function translation(Language $language)
    {
        return $this->hasOne(QuizQuestionTranslation::class)->where('language_id', $language->id);
    }

    public function hasTranslation(Language $language): bool
    {
        return $this->translation($language)->exists();
    }

    public function translate(Language $selected_lang): string
    {
        Log::debug($selected_lang);
        $ret = '';
        $default_lang = Language::where('default', true)->first();
        $fallback_lang = Language::where('code', 'PT')->first();

        if ($selected_lang == $fallback_lang) {
            return $this->question;
        }

        $ret = $this->translation($selected_lang)->first();

        if (!$ret) {
            $ret = $this->translation($default_lang)->first();
        }

        if (!$ret) {
            return $this->question;
        }

        return $ret->value ?? '';
    }
}
