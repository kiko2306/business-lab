<?php

namespace Tests\Feature;

use App\Helpers\TranslationKeysEnum;
use App\Models\Language;
use App\Models\Translation;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class TranslationTest extends TestCase
{
    use DatabaseMigrations;

    public function setUp(): void
    {
        parent::setUp();
        Artisan::call('db:seed');
    }

    /**
     * A basic feature test example.
     *
     * @return void
     */
    public function testCanCreateNew()
    {
        $trans = new Translation([
            'key' => TranslationKeysEnum::NEW_USER_WELCOME_MAIL_TEXT,
            'value' => 'Good morning',
            'language_id' => Language::where('default', true)->first()->id,
        ]);

        $response = $this->actingAs(User::find(1))->post(route('translations.store'), $trans->toArray());

        $response->assertStatus(200);
    }

    public function testCanCreateSameKeyNewLanguage()
    {
        $trans = new Translation([
            'key' => TranslationKeysEnum::NEW_USER_WELCOME_MAIL_TEXT,
            'value' => 'Good morning',
            'language_id' => Language::where('code', 'PT')->first()->id,
        ]);

        $response = $this->actingAs(User::find(1))->post(route('translations.store'), $trans->toArray());

        $response->assertStatus(200);
    }

    public function testCanUpdate()
    {
        $trans = new Translation([
            'key' => TranslationKeysEnum::NEW_USER_WELCOME_MAIL_TEXT,
            'value' => 'Good morning',
            'language_id' => Language::where('code', 'PT')->first()->id,
        ]);

        $trans->save();

        $trans->value = 'Bom dia';

        $response = $this->actingAs(User::find(1))->put(route('translations.update', ['id' => $trans->id]), $trans->toArray());

        $response->assertStatus(200);
    }

    public function testCanDelete()
    {
        auth()->login(User::find(1));

        $trans = Translation::all();

        foreach ($trans as $translation) {
            $response = $this->delete(route('translations.destroy', ['id' => $translation->id]));
            $response->assertStatus(200);
        }

        $this->assertDatabaseCount('translations', 0);
    }
}
