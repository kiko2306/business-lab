<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use LivewireUI\Modal\ModalComponent;

class ModalUpdatePrivacyText extends ModalComponent
{
    public $text;

    public function mount($text)
    {
        $this->text = $text;
        $this->modalMaxWidth();
    }

    public static function modalMaxWidth(): string
    {
        return '7xl';
    }

    public function render()
    {
        return view('livewire.modal-update-privacy-text');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $lang_id = Language::where('code', 'PT')->first()->id;

        $tr = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT)
        ->where('language_id', $lang_id)
        ->first();

        $tr->value = $this->text;

        $tr->save();

        $this->closeModal();
        $this->emit('eventChanged');
    }
}
