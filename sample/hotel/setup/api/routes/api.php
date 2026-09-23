<?php

use App\Http\Controllers\API\CheckInResultController;
use App\Http\Controllers\API\ConfigurationController;
use App\Http\Controllers\API\GuestController;
use App\Http\Controllers\API\ReservationController;
use App\Http\Controllers\API\UnitsController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

Route::get('/ping', function () {
    return response()->json(['message' => 'ok']);
})->middleware('conn.registration');

Route::get('/config',[ConfigurationController::class, 'index']);

Route::post('/guests', [GuestController::class, 'store'])
    ->name('api.guests.store')
    ->middleware('conn.registration');

Route::post('/guests-lst', [GuestController::class, 'storeAll'])
    ->name('api.guests.storeAll')
    ->middleware('conn.registration');

Route::post('/reservations', [ReservationController::class, 'store'])
    ->name('api.reservations.store')
    ->middleware('conn.registration');

Route::get('/checkin-complete', [ReservationController::class, 'index'])
    ->name('api.reservations.index')
    ->middleware('conn.registration');

Route::post('/checkin/success', [CheckInResultController::class, 'success'])
    ->middleware('conn.registration');

Route::post('/checkin/fail', [CheckInResultController::class, 'fail'])
    ->middleware('conn.registration');

Route::post('/units', [UnitsController::class, 'store'])
    ->middleware('conn.registration');

