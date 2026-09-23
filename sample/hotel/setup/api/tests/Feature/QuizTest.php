<?php

namespace Tests\Feature;

use App\Helpers\ConfigKeysEnum;
use App\Helpers\EventKeysEnum;
use App\Helpers\ReservationStatusKeysEnum;
use App\Models\Configuration;
use App\Models\Event;
use App\Models\Guest;
use App\Models\Quiz;
use App\Models\Reservation;
use App\Models\Unit;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class QuizTest extends TestCase
{
    // use DatabaseMigrations;

    public function setUp(): void
    {
        parent::setUp();
        Artisan::call('migrate:fresh');
        Artisan::call('db:seed');
    }

    public function testCantSendQuizIfEventInactive()
    {
        Reservation::factory(10)->create();

        $this->assertDatabaseCount('reservations', 10);

        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(400);
    }

    public function testCantSendQuizIfStatusNotCko()
    {
        Event::where('code', EventKeysEnum::QUIZ)->update(['is_active' => true]);

        $this->assertDatabaseHas('events', [
            'code' => EventKeysEnum::QUIZ,
            'is_active' => true,
        ]);

        $reservation = Reservation::factory(1)->make(
            [
                'checkout' => Carbon::now()->subDay(3)->format('Y-m-d'),
                'status' => ReservationStatusKeysEnum::CHECKIN,
                ]
        );

        $reservation[0]->guest->mailable = true;
        $reservation[0]->guest->email = 'Carlos Friasamtx@gmail.com';
        $reservation[0]->guest->save();
        $reservation[0]->save();

        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(200);
    }

    public function testCanSendQuizIfEventActive()
    {
        // Quiz event must be active
        Event::where('code', EventKeysEnum::QUIZ)->update(['is_active' => true]);
        $this->assertDatabaseHas('events', [
            'code' => EventKeysEnum::QUIZ,
            'is_active' => true,
        ]);

        // Add logo for email
        Configuration::create([
            'key' => ConfigKeysEnum::LOGO,
            'value' => 'logo.png',
        ]);

        // Set units to send checkout quiz
        Unit::query()->update(['checkout_quiz_is_active' => true]);

        // Set quizzes active
        Quiz::query()->update(['is_active' => true]);

        // user access to unit and with notify_guest_invalid_mail
        $user = User::factory()->make([
            'name' => 'Carlos Frias',
            'email' => 'cfrias@sapo.pt',
            'notify_guest_invalid_mail' => true,
        ]);
        $user->save();
        $units = Unit::all();
        $unit_ids = $units->pluck('id')->toArray();
        $user->setUnits($unit_ids);

        // guest with valid email
        $guest = Guest::factory()->make();
        $guest->mailable = true;
        $guest->email = 'cfrias@sapo.pt';
        $guest->save();

        // reservation for guest
        Reservation::factory()->create([
            'guest_id' => $guest->id,
            'status' => ReservationStatusKeysEnum::CHECKOUT,
            'checkout' => Carbon::now()->subDay(3)->format('Y-m-d'),
        ]);

        // api send reservations request
        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(200);
    }

    public function testCanSendQuizIfLogoNotPresent()
    {
        Event::where('code', EventKeysEnum::QUIZ)->update(['is_active' => true]);

        $this->assertDatabaseHas('events', [
            'code' => EventKeysEnum::QUIZ,
            'is_active' => true,
        ]);

        $reservation = Reservation::factory(1)->make(
            [
                'checkout' => Carbon::now()->subDay(3)->format('Y-m-d'),
                'status' => ReservationStatusKeysEnum::CHECKOUT,
                ]
        );

        $reservation[0]->guest->mailable = true;
        $reservation[0]->guest->email = 'test@testing.com';
        $reservation[0]->guest->save();
        $reservation[0]->save();

        $this->assertDatabaseCount('reservations', 1);

        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(200);
    }

    public function testNotifyUserIfEmailInvalid()
    {
        // Quiz event must be active
        Event::where('code', EventKeysEnum::QUIZ)->update(['is_active' => true]);
        $this->assertDatabaseHas('events', [
            'code' => EventKeysEnum::QUIZ,
            'is_active' => true,
        ]);

        // Add logo for email
        Configuration::create([
            'key' => ConfigKeysEnum::LOGO,
            'value' => 'logo.png',
        ]);

        // Set units to send checkout quiz (NOT NEEDED)
        Unit::query()->update(['checkout_quiz_is_active' => true]);

        // Set quizzes active
        Quiz::query()->update(['is_active' => true]);

        // user access to unit and with notify_guest_invalid_mail
        $user = User::factory()->make([
            'name' => 'Carlos Frias',
            'email' => 'cfrias@sapo.pt',
            'notify_guest_invalid_mail' => true,
        ]);
        $user->save();
        $units = Unit::all();
        $unit_ids = $units->pluck('id')->toArray();
        $user->setUnits($unit_ids);

        // guest with invalid email
        $guest = Guest::factory()->make();
        $guest->mailable = true;
        $guest->email = 'mat<test@test.com>';
        $guest->save();

        // reservation for guest
        Reservation::factory()->create([
            'guest_id' => $guest->id,
            'status' => ReservationStatusKeysEnum::CHECKOUT,
            'checkout' => Carbon::now()->subDay(3)->format('Y-m-d'),
        ]);

        // api send reservations request
        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(200);
    }

    public function testNotifyUserIfNoEmail()
    {
        // Quiz event must be active
        Event::where('code', EventKeysEnum::QUIZ)->update(['is_active' => true]);
        $this->assertDatabaseHas('events', [
            'code' => EventKeysEnum::QUIZ,
            'is_active' => true,
        ]);

        // Add logo for email
        Configuration::create([
            'key' => ConfigKeysEnum::LOGO,
            'value' => 'logo.png',
        ]);

        // Set units to send checkout quiz (NOT NEEDED)
        Unit::query()->update(['checkout_quiz_is_active' => true]);

        // Set quizzes active
        Quiz::query()->update(['is_active' => true]);

        // user access to unit and with notify_guest_invalid_mail
        $user = User::factory()->make([
            'name' => 'Carlos Frias',
            'email' => 'cfrias@sapo.pt',
            'notify_guest_no_mail' => true,
        ]);
        $user->save();
        $units = Unit::all();
        $unit_ids = $units->pluck('id')->toArray();
        $user->setUnits($unit_ids);

        // guest with invalid email
        $guest = Guest::factory()->make();
        $guest->mailable = true;
        $guest->email = null;
        $guest->save();

        // reservation for guest
        Reservation::factory()->create([
            'guest_id' => $guest->id,
            'status' => ReservationStatusKeysEnum::CHECKOUT,
            'checkout' => Carbon::now()->subDay(3)->format('Y-m-d'),
        ]);

        // api send reservations request
        $response = $this->post(route('api.quiz.send'), []);

        $response->assertStatus(200);
    }
}
