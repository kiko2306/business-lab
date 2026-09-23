<?php

use App\Models\Style;
use Illuminate\Database\Migrations\Migration;

class AddDefaultStyle extends Migration
{
    /**
     * Run the migrations.
     *
     * @return void
     */
    public function up()
    {
        Style::create([
            'name' => 'Default',
            'primary' => '#007bff',
            'secondary' => '#6c757d',
            'success' => '#28a745',
            'danger' => '#dc3545',
            'warning' => '#ffc107',
            'info' => '#17a2b8',
            'light' => '#f8f9fa',
            'dark' => '#343a40',
            'text_on_color' => '#fff',
            'active' => true,
        ]);
    }

    /**
     * Reverse the migrations.
     *
     * @return void
     */
    public function down()
    {
        Style::truncate();
    }
}
