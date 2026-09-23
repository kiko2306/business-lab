<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use LivewireUI\Modal\ModalComponent;

class ModalUpdateCheckinPageText extends ModalComponent
{
    public $text;
    public $lang_id;

    public function mount($text, $lang_id = null)
    {
        if (!$lang_id) {
            $this->lang_id = Language::where('code', 'PT')->first()->id;
        }
        $this->text = $text;
        $this->modalMaxWidth();
    }

    public static function modalMaxWidth(): string
    {
        return '7xl';
    }

    public function render()
    {
        return view('livewire.modal-update-checkin-page-text');
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

        $tr = Translation::where('key', TranslationKeysEnum::CHECKIN_PAGE_TEXT)
        ->where('language_id', $this->lang_id)
        ->first() ?? new Translation([
            'key' => TranslationKeysEnum::CHECKIN_PAGE_TEXT,
            'language_id' => $this->lang_id,
            'value' => $this->text,
        ]);

        $tr->value = $this->text;

        $tr->save();

        $this->closeModal();
        $this->emit('eventChanged');
    }
}
