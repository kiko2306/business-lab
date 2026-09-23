<?php

namespace Tests\Feature;

use App\Models\Unit;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class UserTest extends TestCase
{
    use DatabaseMigrations;

    protected User $admin;

    public function setUp(): void
    {
        parent::setUp();
        Artisan::call('db:seed');
        $this->admin = User::find(1);
    }

    public function testCantAddUserIfNotLoggedIn()
    {
        $user_to_save = User::factory()->make();

        $response = $this->post(route('users.store', ), $user_to_save->toArray());

        $response->assertRedirect('/login');
    }

    /**
     * A basic feature test example.
     *
     * @return void
     */
    public function testCanAddUser()
    {
        $user_to_save = User::factory()->make();

        $response = $this->actingAs($this->admin)->post(route('users.store', ), $user_to_save->toArray());

        $response->assertStatus(200);

        $this->assertDatabaseHas('users', [
            'name' => $user_to_save->name,
            'email' => $user_to_save->email,
        ]);
    }

    public function testCantCreateUserWithDuplicatedEmail()
    {
        $user_to_save = User::factory()->make();

        $response = $this->actingAs($this->admin)->post(route('users.store', ), $user_to_save->toArray());

        $response->assertStatus(200);

        $this->assertDatabaseHas('users', [
            'name' => $user_to_save->name,
            'email' => $user_to_save->email,
        ]);

        $new_user_to_save = User::factory()->make(['email' => $user_to_save->email]);

        $response = $this->actingAs($this->admin)->post(route('users.store', ), $new_user_to_save->toArray());

        $response->assertStatus(302);
    }

    public function testCanDeleteUser()
    {
        $user_to_delete = User::factory()->create();

        $response = $this->actingAs($this->admin)->delete(route('users.destroy', $user_to_delete->id));

        $response->assertStatus(200);

        $this->assertDatabaseMissing('users', [
            'name' => $user_to_delete->name,
            'email' => $user_to_delete->email,
            'password' => $user_to_delete->password,
            'is_admin' => $user_to_delete->is_admin,
        ]);
    }

    public function testCantDeleteLastAdmin()
    {
        User::where('is_admin', true)->where('id', '!=', '1')->delete();

        $user = User::find(1);
        $this->assertTrue($user->is_admin);

        $response = $this->actingAs($this->admin)->delete(route('users.destroy', $user->id));

        $response->assertStatus(302);
    }

    public function testCanAddUnitToUser()
    {
        $user = User::factory()->create();

        $units = Unit::all();
        $unit_ids = $units->pluck('id')->toArray();
        //$user->setUnits($unit_ids);

        //$this->assertEquals($user->units->count(), 2);

        $data = $user->toArray();
        $data['units'] = $unit_ids;

        $response = $this->actingAs($this->admin)->put(
            route('users.update', $user->id),
            $data
        );

        $response->assertStatus(200);

        $this->assertEquals(User::find($user->id)->units->count(), $units->count());
    }
}
