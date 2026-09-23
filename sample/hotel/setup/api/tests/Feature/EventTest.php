<?php

namespace Tests\Feature;

use App\Helpers\EventKeysEnum;
use App\Models\Event;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class EventTest extends TestCase
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
    public function testCanSetActiveStatusTrue()
    {
        $event = Event::where('code', EventKeysEnum::CHECKIN)->first();

        $event->active = true;

        $response = $this->actingAs(User::find(1))->put(route('events.update', $event->id), $event->toArray());

        $response->assertStatus(200);
    }

    public function testCanSetActiveStatusFalse()
    {
        $event = Event::where('code', EventKeysEnum::CHECKIN)->first();

        $data = $event->toArray();

        unset($data['is_active']);

        $response = $this->actingAs(User::find(1))->put(route('events.update', $event->id), $data);

        $response->assertStatus(200);
    }
}
