<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ChatController;

Route::inertia('/', 'welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::inertia('dashboard', 'dashboard')->name('dashboard');

    Route::prefix('chat')->name('chat.')->group(function () {
        Route::get('/', [ChatController::class, 'index'])->name('index');

        Route::post('/start/{user}', [ChatController::class, 'start'])
            ->whereNumber('user')
            ->name('start');

        Route::get('/{conversation}/messages', [ChatController::class, 'messages'])
            ->whereNumber('conversation')
            ->name('messages');

        Route::post('/{conversation}/messages', [ChatController::class, 'send'])
            ->whereNumber('conversation')
            ->name('send');
    });
});

require __DIR__.'/settings.php';