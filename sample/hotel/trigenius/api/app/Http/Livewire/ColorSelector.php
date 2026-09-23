<?php

namespace App\Http\Livewire;

use App\Models\Style;
use Illuminate\Support\Facades\Log;
use Livewire\Component;

class ColorSelector extends Component
{
    public $color_keys;
    public $selectedColor;
    public $style;

    public function mount()
    {
        $this->style = Style::active();
        $this->color_keys = $this->style->getEditableColorKeys();
    }

    public function render()
    {
        return view('livewire.color-selector');
    }

    public function save()
    {
        Log::debug($this->style);
    }
}
