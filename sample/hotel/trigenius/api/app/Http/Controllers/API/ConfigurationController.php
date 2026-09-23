<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Configuration;
use Illuminate\Http\Request;

class ConfigurationController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function index()
    {
        $configuration = Configuration::all();

        $wintouch_user = $configuration->where('key', 'WINTOUCH_USER')->first()->value ?? '';
        $wintouch_password = $configuration->where('key', 'WINTOUCH_PASSWORD')->first()->value ?? '';
        $wintouch_database = $configuration->where('key', 'WINTOUCH_DATABASE')->first()->value ?? '';

        $config = [
            'user' => $wintouch_user,
            'password' => $wintouch_password,
            'database' => $wintouch_database,
        ];

        return response()->json([
            'config' => $config,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
    }

    /**
     * Display the specified resource.
     *
     * @param int $id
     *
     * @return \Illuminate\Http\Response
     */
    public function show($id)
    {
    }

    /**
     * Update the specified resource in storage.
     *
     * @param int $id
     *
     * @return \Illuminate\Http\Response
     */
    public function update(Request $request, $id)
    {
    }

    /**
     * Remove the specified resource from storage.
     *
     * @param int $id
     *
     * @return \Illuminate\Http\Response
     */
    public function destroy($id)
    {
    }
}
