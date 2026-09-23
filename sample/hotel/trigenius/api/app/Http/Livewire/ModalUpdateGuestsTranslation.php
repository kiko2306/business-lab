<?php

namespace App\Http\Livewire;

use App\Models\Language;
use App\Models\Translation;
use LivewireUI\Modal\ModalComponent;
use Illuminate\Support\Str;

class ModalUpdateGuestsTranslation extends ModalComponent
{
    public $text;
    public $lang_id;
    public $key;
    public $title;
    public $language_name;

    public function mount($key, $text, $lang_id = null)
    {
        if (!$lang_id) {
            $this->lang_id = Language::where('code', 'PT')->first()->id;
        }

        $this->language_name = Language::find($this->lang_id)->name;

        $this->title = Translation::where('key', $key)
        ->where('language_id', Language::where('code', 'PT')->first()->id)
        ->first()->value;

        $this->key = $key;

        $this->text = $text;
    }

    public function render()
    {
        return view('livewire.modal-update-guests-translation');
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
                'key' => 'required',
            ]
        );

        $tr = Translation::where('key', $this->key)
        ->where('language_id', $this->lang_id)
        ->first() ?? new Translation([
            'key' => $this->key,
            'language_id' => $this->lang_id,
            'value' => $this->text,
        ]);

        $tr->value = Str::replace(['<p>', '</p>'], '', $this->text);

        $tr->save();

        $this->closeModal();
        $this->emit('eventChanged');
    }
}
