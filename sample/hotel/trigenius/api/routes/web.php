<?php

use App\Http\Controllers\CheckinController;
use App\Http\Controllers\CkEditorController;
use App\Http\Controllers\QuizController;
use App\Http\Controllers\UnsubscribeController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/linkstorage', function () {
    // Artisan::call('storage:link');
    $targetFolder = base_path().'/storage/app/public';
    $linkFolder = $_SERVER['DOCUMENT_ROOT'].'/storage';

    dump($targetFolder);
    dump($linkFolder);

    // dd();
    symlink($targetFolder, $linkFolder);

    return response()->json(['message' => 'done']);
});

Route::get('/', function () {
    return redirect('login');
});

Route::get('quiz/{uuid}', [QuizController::class, 'edit'])->name('quiz.edit');
Route::get('quiz_saved/{uuid}', [QuizController::class, 'done'])->name('quiz.thank_you');

Route::get('checkin/{uuid}', [CheckinController::class, 'edit'])->name('checkin.edit');
Route::post('checkin/{uuid}', [CheckinController::class, 'store'])->name('checkin.post');
Route::get('/check-in-done/{uuid}', [CheckinController::class, 'done'])->name('checkin.done');
Route::view('/check-in-duplicated', 'checkin.duplicated')
    ->name('check-in.duplicated');

Route::get('unsubscribe/{uuid}', [UnsubscribeController::class, 'show'])->name('unsubscribe.show');
Route::put('/unsubscribe/{id}', [UnsubscribeController::class, 'update'])->name('unsubscribe.update');

Route::middleware(['auth'])->group(function () {
    Route::get('/change-password', function () {
        return redirect()->to(route('profile.show').'#update-password');
    })->name('password.change');

    // Dashboard
    Route::get('/dashboard', function () {
        return view('dashboard.main.menu');
    })->name('dashboard');

    Route::get('/dashboard/reservation-countries', function () {
        return view('dashboard.main.reservation-countries');
    })->name('dashboard.reservation-countries');

    Route::get('/dashboard/checkin-sent', function () {
        return view('dashboard.main.checkin-sent');
    })->name('dashboard.checkin-sent');

    Route::get('/dashboard/checkin-success', function () {
        return view('dashboard.main.checkin-success');
    })->name('dashboard.checkin-success');

    Route::get('/dashboard/quiz-sent', function () {
        return view('dashboard.main.quiz-sent');
    })->name('dashboard.quiz-sent');

    Route::get('/dashboard/quiz-success', function () {
        return view('dashboard.main.quiz-success');
    })->name('dashboard.quiz-success');

    Route::get('/dashboard/quiz-answers', function () {
        return view('dashboard.main.quiz-answers');
    })->name('dashboard.quiz-answers');

    // Config
    Route::get('/configuration', function () {
        return view('dashboard.config.menu');
    })->name('configuration.menu');

    Route::get('/configuration/db-connection', function () {
        return view('dashboard.config.db_connection');
    })->name('configuration.db_connection');

    Route::get('/configuration/units', function () {
        return view('dashboard.config.units');
    })->name('configuration.units');

    Route::get('/configuration/logo', function () {
        return view('dashboard.config.logo');
    })->name('configuration.logo');

    Route::get('/configuration/personal-page', function () {
        return view('dashboard.config.personal-page');
    })->name('configuration.personal-page');

    Route::get('/configuration/users', function () {
        return view('dashboard.config.users');
    })->name('configuration.users');

    Route::get('/configuration/events', function () {
        return view('dashboard.config.events');
    })->name('configuration.events');

    Route::get('/configuration/texts', function () {
        return view('dashboard.config.texts');
    })->name('configuration.texts');

    Route::get('/configuration/quiz', function () {
        return view('dashboard.config.quiz');
    })->name('configuration.quiz');

    Route::get('/configuration/quiz-groups', function () {
        return view('dashboard.config.quiz-groups');
    })->name('configuration.quiz-groups');

    Route::get('/configuration/quiz-questions', function () {
        return view('dashboard.config.quiz-questions');
    })->name('configuration.quiz-questions');

    Route::get('/configuration/test-checkin', function () {
        return view('dashboard.config.test-checkin');
    })->name('configuration.test-checkin');

    Route::get('/configuration/test-quiz', function () {
        return view('dashboard.config.test-quiz');
    })->name('configuration.test-quiz');

    // Translations
    Route::get('/translation', function () {
        return view('dashboard.translate.menu');
    })->name('translation.menu');

    Route::get('/translation/country-language', function () {
        return view('dashboard.translate.country-language');
    })->name('translation.country-language');

    Route::get('/translation/checkin', function () {
        return view('dashboard.translate.checkin');
    })->name('translation.checkin');

    Route::get('/translation/quiz', function () {
        return view('dashboard.translate.quiz');
    })->name('translation.quiz');

    Route::get('/translation/birthday', function () {
        return view('dashboard.translate.birthday');
    })->name('translation.birthday');

    Route::get('/translation/promo', function () {
        return view('dashboard.translate.promo');
    })->name('translation.promo');

    Route::get('/translation/system', function () {
        return view('dashboard.translate.system');
    })->name('translation.system');

    Route::get('/translation/guests', function () {
        return view('dashboard.translate.guests');
    })->name('translation.guests');

    Route::get('/test', function () {
        return view('test');
    })->name('test');
});

Route::post('editor/image-upload', [CkEditorController::class, 'upload'])->name('editor-upload');

require __DIR__.'/auth.php';
