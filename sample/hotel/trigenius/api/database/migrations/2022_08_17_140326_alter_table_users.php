<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

class AlterTableUsers extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->boolean('is_admin')->after('password')->default(false);

            $table->boolean('email_quiz_response')->after('is_admin')->default(false);
            $table->boolean('email_check_in_response')->after('email_quiz_response')->default(false);

            $table->boolean('notify_guest_no_mail')->after('email_check_in_response')->default(false);
            $table->boolean('notify_guest_invalid_mail')->after('notify_guest_no_mail')->default(false);
            $table->boolean('notify_service_connection_delay')->after('notify_guest_invalid_mail')->default(false);
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['is_admin', 'email_quiz_response',
            'email_check_in_response', 'notify_guest_no_mail', 'notify_guest_invalid_mail', ]);
        });
    }
}
