<?php

namespace App\Http\Livewire;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use LivewireUI\Modal\ModalComponent;
use Illuminate\Support\Str;

class ModalUpdatePrivacyTitle extends ModalComponent
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
        return view('livewire.modal-update-privacy-title');
    }

    public function close()
    {
        $this->closeModal();
    }

    public function save()
    {
        $lang_id = Language::where('code', 'PT')->first()->id;

        $tr = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE)
        ->where('language_id', $lang_id)
        ->first();

        $tr->value = Str::replace(['<p>', '</p>'], '', $this->text);

        $tr->save();

        $this->closeModal();
        $this->emit('eventChanged');
    }
}
