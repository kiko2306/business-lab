<?php

namespace App\Console\Commands;

use App\Helpers\Delay;
use App\Jobs\ServiceConnectionLostJob;
use App\Models\ConnLog;
use Carbon\Carbon;
use Illuminate\Console\Command;

class ConnCheck extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'conn:check';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Service connection check';

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
        $conn_log = ConnLog::first();

        if (!$conn_log) {
            return;
        }

        if ($conn_log->last_connection < Carbon::now()->subMinutes(15) && !$conn_log->notified) {
            $conn_log->notified = true;
            $conn_log->save();
            ServiceConnectionLostJob::dispatch()->delay(Delay::get());
        }
    }
}
