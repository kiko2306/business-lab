<?php

namespace App\Console\Commands;

use App\Helpers\EventKeysEnum;
use App\Models\Event;
use App\Models\Quiz;
use Illuminate\Console\Command;

class SendEvents extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'events:send';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Send all events';

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
        $events = Event::where('is_active', true)->get();

        foreach ($events as $event) {
            switch ($event->name) {
                case EventKeysEnum::BIRTHDAY :
                    // code...
                    break;

                case EventKeysEnum::CHECKIN :
                    // code...
                    break;

                case EventKeysEnum::QUIZ :
                    Quiz::send();
                    break;

                case EventKeysEnum::PROMO :
                    // code...
                    break;

                default:
                    // code...
                    break;
            }
        }
    }
}
