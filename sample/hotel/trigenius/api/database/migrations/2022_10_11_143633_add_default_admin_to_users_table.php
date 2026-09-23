<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

class AddDefaultAdminToUsersTable extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Schema::table('users', function (Blueprint $table) {
            $user = new User();
            $user->name = 'Admin';
            $user->email = 'geral@portoinf.com';
            $user->password = Hash::make('e1zpXp9');
            $user->is_admin = true;
            $user->save();

            $user->markEmailAsVerified();
        });
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        User::find(1)->delete();
    }
}
