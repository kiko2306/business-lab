<?php

namespace App\Console\Commands;

use App\Helpers\EventKeysEnum;
use App\Models\Event;
use App\Models\Reservation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class SendQuiz extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'quiz:send';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Send Quizzes';

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
        $event = Event::where('code', EventKeysEnum::QUIZ)->first();

        if (!$event) {
            return;
        }

        if (!$event->is_active) {
            return;
        }

        Log::info('Sending Quiz');

        Reservation::sendQuiz($event->days_offset);
    }
}
