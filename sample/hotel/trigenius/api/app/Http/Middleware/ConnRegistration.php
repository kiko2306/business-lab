<?php

namespace App\Http\Middleware;

use App\Models\ConnLog;
use Carbon\Carbon;
use Closure;
use Illuminate\Http\Request;

class ConnRegistration
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Illuminate\Http\Response|\Illuminate\Http\RedirectResponse)  $next
     *
     * @return \Illuminate\Http\Response|\Illuminate\Http\RedirectResponse
     */
    public function handle(Request $request, Closure $next)
    {
        ConnLog::updateOrCreate(['id' => 1], [
            'last_connection' => Carbon::now(),
            'notified' => false,
        ]);

        return $next($request);
    }
}
