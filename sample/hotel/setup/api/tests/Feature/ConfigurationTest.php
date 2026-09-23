<?php

namespace Tests\Feature;

use App\Helpers\ConfigKeysEnum;
use App\Models\Configuration;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class ConfigurationTest extends TestCase
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
    public function testCanSaveNewWintouchUser()
    {
        $config = Configuration::factory(1)
        ->make(['key' => ConfigKeysEnum::WINTOUCH_USER, 'value' => 'sa'])[0];

        $response = $this->actingAs(User::find(1))->post(route('configuration.store'), $config->toArray());

        $response->assertStatus(200);

        $this->assertDatabaseHas(
            'configurations',
            ['key' => ConfigKeysEnum::WINTOUCH_USER, 'value' => 'sa']
        );
    }

    public function testCanUpdateWintouchUser()
    {
        $configuration = Configuration::factory(1)
        ->create(['key' => ConfigKeysEnum::WINTOUCH_USER, 'value' => 'sa'])[0];

        $configuration->value = 'sa2';

        $response = $this->actingAs(User::find(1))
        ->put(route('configuration.update', ['id' => $configuration->id]), $configuration->toArray());

        $response->assertStatus(200);

        $this->assertDatabaseHas('configurations', ['key' => ConfigKeysEnum::WINTOUCH_USER, 'value' => 'sa2']);
    }

    public function testCanUpdateWintouchUserWithNull()
    {
        $configuration = Configuration::factory(1)->create([
            'key' => ConfigKeysEnum::WINTOUCH_USER,
            'value' => null,
        ])[0];

        $response = $this->actingAs(User::find(1))->put(
            route('configuration.update', ['id' => $configuration->id]),
            $configuration->toArray()
        );

        $response->assertStatus(200);

        $this->assertDatabaseHas('configurations', [
            'key' => ConfigKeysEnum::WINTOUCH_USER,
            'value' => null,
        ]);
    }

    public function testCanDeleteConfiguration()
    {
        $configuration = Configuration::factory(1)->create([
            'key' => ConfigKeysEnum::WINTOUCH_USER,
            'value' => 'sa',
        ])[0];

        $response = $this->actingAs(User::find(1))->delete(
            route(
                'configuration.destroy',
                ['id' => $configuration->id]
            )
        );

        $response->assertStatus(200);

        $this->assertDatabaseMissing(
            'configurations',
            $configuration->toArray()
        );
    }
}
