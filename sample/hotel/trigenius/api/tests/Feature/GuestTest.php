<?php

namespace Tests\Feature;

use App\Models\Guest;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class GuestTest extends TestCase
{
    use DatabaseMigrations;

    public function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        Artisan::call('db:seed');
    }

    /**
     * A basic feature test example.
     *
     * @return void
     */
    public function testCanCreateMultipleGuest()
    {
        $guest = Guest::factory(1000)->make();

        $response = $this->post(route('api.guests.store'), $guest->toArray());

        $response->assertOk()
            ->assertJson(['count' => 1000]);
    }

    public function testCanUpdateMultipleGuest()
    {
        $guest = Guest::all()->take(10);

        foreach ($guest as $guestData) {
            $guestData->last_name = 'updated';
        }

        $response = $this->post(route('api.guests.store'), $guest->toArray());

        $response->assertOk()
            ->assertJson(['count' => 10]);

        foreach ($guest as $guestData) {
            $this->assertDatabaseHas('guests', [
                'code' => $guestData->code,
                'last_name' => 'updated',
            ]);
        }
    }

    public function testBulkGuestValidationAlwaysReturnsJson()
    {
        $response = $this->post(route('api.guests.store'), [
            ['name' => 'Missing code'],
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors('guests.0.code');
    }

    public function testGuestCanUnsubscribe()
    {
        $guestLst = Guest::factory(1)->create(['mailable' => true]);

        $this->assertDatabaseHas('guests', [
            'id' => $guestLst[0]->id,
            'mailable' => true,
        ]);

        $response = $this->put(route('unsubscribe.update', ['id' => $guestLst[0]->id]), []);

        $response->assertStatus(200);

        $this->assertDatabaseHas('guests', [
            'id' => $guestLst[0]->id,
            'mailable' => false,
        ]);
    }
}
