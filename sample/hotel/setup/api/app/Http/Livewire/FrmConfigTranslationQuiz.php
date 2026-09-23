<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Country;
use App\Models\Language;
use App\Models\Quiz;
use App\Models\Translation;
use Livewire\Component;

class FrmConfigTranslationQuiz extends Component
{
    public $selected_translation_key;
    public ?Quiz $selected_quiz;
    public $selected_modal;

    public $countries;
    public $languages;
    public $default_value;
    public $translated_values;

    public $quizzes;

    public $rules = [
        'countries.*.language_id' => 'required',
        'countries.*.code' => 'required',
        'countries.*.name' => 'required',
        'translated_values.*.language_id' => 'required',
        'translated_values.*.value' => 'required',
    ];

    public $listeners = [
        'eventChanged' => 'updatedSelectedTranslationKey',
        'refreshTranslations' => '$refresh',
    ];

    public function mount()
    {
        $this->getCountries();
        $this->quizzes = Quiz::all();
    }

    public function getCountries()
    {
        $this->countries = Country::select('language_id')
            ->where('language_id', '!=', '')
            ->where('language_id', '!=', Language::where('code', 'PT')->first()->id)
            ->distinct()
            ->get();
    }

    public function render()
    {
        return view('livewire.frm-config-translation-quiz');
    }

    public function hasAllTranslations($key): bool
    {
        return Translation::where('key', $key)->count() - 1 == $this->countries->count();
    }

    public function setSelectedTranslationKey(string $selected_translation_key)
    {
        $this->selected_quiz = null;

        switch ($selected_translation_key) {
            case TranslationKeysEnum::QUIZ_MAIL_SUBJECT:
                $this->selected_modal = 'modal-update-quiz-email-subject';
                break;

            case TranslationKeysEnum::QUIZ_MAIL_TEXT:
                $this->selected_modal = 'modal-update-quiz-email-text';
                break;

            case TranslationKeysEnum::BTN_QUIZ:
                $this->selected_modal = 'modal-update-quiz-btn-text';
                break;

            case TranslationKeysEnum::QUIZ_PAGE_TEXT:
                $this->selected_modal = 'modal-update-quiz-page-text';
                break;

            case TranslationKeysEnum::QUIZ_PAGE_SUBMISSION_TEXT:
                $this->selected_modal = 'modal-update-quiz-page-submission-text';
                break;

            default:
                // code...
                break;
        }

        $this->selected_translation_key = $selected_translation_key;
        $this->updatedSelectedTranslationKey();
    }

    public function updatedSelectedTranslationKey()
    {
        $this->default_value = Translation::where('key', $this->selected_translation_key)
            ->where('language_id', Language::where('code', 'PT')->first()->id)
            ->first()->value;

        $this->translated_values = Translation::whereIn('language_id', $this->countries->pluck('language_id'))
            ->where('key', $this->selected_translation_key)
            ->get();

        foreach ($this->countries as $country) {
            if (!$this->translated_values->contains('language_id', $country->language_id)) {
                $this->translated_values->push(new Translation([
                        'key' => $this->selected_translation_key,
                        'language_id' => $country->language_id,
                        'value' => '',
            ]));
            }
        }
    }

    public function quizHasAllTranslations($quiz_id): bool
    {
        return true;
    }

    public function showQuiz($quiz_id)
    {
        $this->selected_translation_key = null;
        $this->selected_quiz = Quiz::find($quiz_id);

        // dd($quiz_id);

        // $this->selected_modal = 'modal-update-quiz';
        // $this->selected_translation_key = $quiz_id;
        // $this->updatedSelectedTranslationKey();
    }
}
