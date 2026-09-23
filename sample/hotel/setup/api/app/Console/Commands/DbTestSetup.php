<?php

namespace App\Console\Commands;

use App\Models\Unit;
use App\Models\User;
use Illuminate\Console\Command;

class DbTestSetup extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'dbtest:setup';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Command description';

    /**
     * Create a new command instance.
     *
     * @return void
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Execute the console command.
     *
     * @return int
     */
    public function handle()
    {
        $unit1 = Unit::create([
            'code' => 'whotel',
            'name' => 'Quintado Vallado',
            'checkout_quiz_id' => 1,
            'checkout_quiz_is_active' => true,
            'checkin_is_active' => true,
            'birthday_is_active' => true,
            'promo_is_active' => true,
        ]);

        $unit2 = Unit::create([
            'code' => 'CASARIO',
            'name' => 'Casa do Rio',
            'checkout_quiz_id' => 1,
            'checkout_quiz_is_active' => true,
            'checkin_is_active' => true,
            'birthday_is_active' => true,
            'promo_is_active' => true,
        ]);

        User::where('id', '!=', 1)->delete();

        $user = User::create([
            'name' => 'Frias',
            'email' => 'cfrias@sapo.pt',
            'password' => '$2y$10$oKjrp85eE7OyXg69kMPdZeeF2eZv56LaQ/EBsMxEkwQbChcTl2nLO', // admin
            'is_admin' => true,
            'email_quiz_response' => true,
            'email_check_in_response' => true,
            'notify_guest_no_mail' => true,
            'notify_guest_invalid_mail' => true,
            'notify_service_connection_delay' => true,
        ]);

        $user->markEmailAsVerified();

        $user->setUnits([$unit1->id, $unit2->id]);
    }
}
