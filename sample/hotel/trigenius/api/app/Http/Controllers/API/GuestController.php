<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\Guest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class GuestController extends Controller
{
    /**
     * Store a newly created resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
        $payload = $request->all();
        $guests = isset($payload[0]) ? $payload : [$payload];

        $validator = Validator::make(['guests' => $guests], [
            'guests' => 'required|array|min:1',
            'guests.*' => 'array',
            'guests.*.code' => 'required',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'The given data was invalid.',
                'errors' => $validator->errors(),
            ], 422);
        }

        DB::transaction(function () use ($guests) {
            foreach ($guests as $guest) {
                Guest::updateOrCreate(['code' => $guest['code']], $guest);
            }
        });

        return response()->json([
            'message' => 'Saved',
            'count' => count($guests),
        ]);
    }

    /**
     * Store a newly created resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function storeAll(Request $request)
    {
        return $this->store($request);
    }
}
