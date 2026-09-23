<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use LivewireUI\Modal\ModalComponent;
use Illuminate\Support\Str;

class ModalUpdateQuizEmailSubject extends ModalComponent
{
    public $text;
    public $lang_id;

    public function mount($text, $lang_id = null)
    {
        if (!$lang_id) {
            $this->lang_id = Language::where('code', 'PT')->first()->id;
        }
        $this->text = $text;
    }

    public function render()
    {
        return view('livewire.modal-update-quiz-email-subject');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $this->validate(
            [
                'text' => 'required',
                'lang_id' => 'required',
            ]
        );

        $tr = Translation::where('key', TranslationKeysEnum::QUIZ_MAIL_SUBJECT)
        ->where('language_id', $this->lang_id)
        ->first() ?? new Translation([
            'key' => TranslationKeysEnum::QUIZ_MAIL_SUBJECT,
            'language_id' => $this->lang_id,
            'value' => $this->text,
        ]);

        $tr->value = Str::replace(['<p>', '</p>'], '', $this->text);

        $tr->save();

        $this->closeModal();
        $this->emit('eventChanged');
    }
}
