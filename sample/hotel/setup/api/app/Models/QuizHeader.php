<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class QuizHeader extends Model
{
    use HasFactory;

    protected $fillable = [
        'quiz_id',
        'title',
        'order',
        'is_active',
    ];

    protected $casts = [
        'order' => 'int',
        'is_active' => 'boolean',
    ];

    public function quizQuestion()
    {
        return $this->hasMany(QuizQuestion::class)->orderBy('order', 'asc');
    }

    public function translation(Language $language)
    {
        return $this->hasOne(QuizHeaderTranslation::class)->where('language_id', $language->id);
    }

    public function hasTranslation(Language $language): bool
    {
        return $this->translation($language)->exists();
    }

    public function translate(Language $selected_lang): string
    {
        $ret = null;
        $default_lang = Language::where('default', true)->first();
        $fallback_lang = Language::where('code', 'PT')->first();

        if ($selected_lang == $fallback_lang) {
            return $this->title;
        }

        $ret = $this->translation($selected_lang)->first();

        if (!$ret) {
            $ret = $this->translation($default_lang)->first();
        }

        if (!$ret) {
            return $this->title;
        }

        return $ret->value ?? '';
    }
}
