<?php

namespace Tests\Feature;

use App\Models\Unit;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class UnitTest extends TestCase
{
    use DatabaseMigrations;

    public function setUp(): void
    {
        parent::setUp();
        Artisan::call('db:seed');
    }

    public function testCantCreateUnitIfNotLoggedIn()
    {
        $response = $this->post(route('unit.create'), [
            'code' => 'test',
            'name' => 'test',
        ]);

        $response->assertStatus(405);
    }

    /**
     * A basic feature test example.
     *
     * @return void
     */
    public function testCanCreateUnit()
    {
        $response = $this->actingAs(User::find(1))->post(route('unit.store'), [
            'code' => 'test',
            'name' => 'test',
        ]);

        $response->assertStatus(200);

        $this->assertDatabaseHas('units', [
            'code' => 'test',
            'name' => 'test',
        ]);
    }

    public function testCantCreateUnitIfCodeDuplicated()
    {
        $response = $this->actingAs(User::find(1))->post(route('unit.store'), [
            'code' => 'test',
            'name' => 'test',
        ]);

        $response->assertStatus(200);

        $response = $this->actingAs(User::find(1))->post(route('unit.store'), [
            'code' => 'test',
            'name' => 'test',
        ]);

        $response->assertStatus(302);
    }

    public function testCanUpdate()
    {
        $unit = Unit::first();

        $response = $this->actingAs(User::find(1))->put(route('unit.update', $unit->id), [
            'code' => 'test',
            'name' => 'test2',
        ]);

        $response->assertStatus(200);

        $this->assertDatabaseHas('units', [
            'code' => 'test',
            'name' => 'test2',
        ]);
    }

    public function testCanDeleteUnit()
    {
        $unit = Unit::first();

        $response = $this->actingAs(User::find(1))->delete(route('unit.destroy', $unit->id));

        $response->assertStatus(200);

        $this->assertDatabaseMissing('units', [
            'id' => $unit->id,
        ]);
    }
}
