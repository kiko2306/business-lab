<?php

namespace App\Models;

use App\Helpers\ColorKeysEnum;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Style extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'primary',
        'secondary',
        'success',
        'danger',
        'warning',
        'info',
        'light',
        'dark',
        'text_on_color',
        'active',
    ];

    protected $casts = [
        'active' => 'boolean',
    ];

    // get active style
    public static function active(): Style
    {
        return Style::where('active', true)->first();
    }

    // set the active style
    public function setActive()
    {
        Style::where('active', true)->update(['active' => false]);

        $this->active = true;
        $this->save();
    }

    // get the color key
    public function getEditableColorKeys(): array
    {
        return ColorKeysEnum::getEditableColorKeys();
    }

    public function getKeyValue($key)
    {
        return ColorKeysEnum::getKeyValue($key);
    }

    public function getKeyByColor($color)
    {
        return ColorKeysEnum::getKeyByColor($color);
    }
}
