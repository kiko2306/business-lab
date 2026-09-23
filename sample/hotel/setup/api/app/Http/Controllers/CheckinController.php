<?php

namespace App\Http\Controllers;

use App\Helpers\ReservationStatusKeysEnum;
use App\Models\Country;
use App\Models\Guest;
use App\Models\GuestExtra;
use App\Models\Reservation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\MessageBag;

class CheckinController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function index()
    {
    }

    /**
     * Show the form for creating a new resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function create()
    {
    }

    /**
     * Store a newly created resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function store(Request $request)
    {
        $checkIn = Reservation::where('uuid', $request->main_guest_0_uuid)->first();

        if ($checkIn->checkin_success) {
            return redirect()->route('check-in.duplicated');
        }

        $errors = new MessageBag();

        $validator = Validator::make($request->all(), [
            'main_guest_0_code' => 'required',
            'main_guest_0_uuid' => 'required|string|max:255',
            'main_guest_0_name' => 'required|min:1',
            'main_guest_0_last_name' => 'required|min:1',
            'main_guest_0_address1' => 'required|min:1',
            'main_guest_0_address2' => '',
            'main_guest_0_address3' => '',
            'main_guest_0_zip_code' => 'required|min:1',
            'main_guest_0_city' => 'required|min:1',
            'main_guest_0_nationality' => 'required',
            'main_guest_0_country' => 'required|min:2',
            'main_guest_0_phone' => '',
            'main_guest_0_email' => 'required|email',
            'main_guest_0_nif' => '',
            'main_guest_0_gender' => 'required',
            'main_guest_0_doc' => 'required',
            'main_guest_0_doc_number' => 'required',
            'main_guest_0_doc-number_id_control' => '',
            'main_guest_0_doc_date' => '',
            'main_guest_0_doc_valid' => '',
            'main_guest_0_doc_local' => '',
            'main_guest_0_doc_country' => 'required',
            'main_guest_0_doc_by' => '',
            'main_guest_0_birth_local' => 'required',
            'main_guest_0_birth_date' => 'required|date',
        ]);

        if ($validator->fails()) {
            $errors->merge($validator->getMessageBag());
        }

        for ($i = 0; $i < $checkIn->adults + $checkIn->children + $checkIn->babies - 1; ++$i) {
            if ($request->has('other_guest_'.($i + 1).'_ignore')) {
                continue;
            }

            $validator = Validator::make($request->all(), [
                'other_guest_'.($i + 1).'_nationality' => 'required',
                'other_guest_'.($i + 1).'_name' => 'required|min:1',
                'other_guest_'.($i + 1).'_last_name' => 'required|min:1',
                'other_guest_'.($i + 1).'_address1' => 'required|min:1',
                'other_guest_'.($i + 1).'_address2' => '',
                'other_guest_'.($i + 1).'_address3' => '',
                'other_guest_'.($i + 1).'_zip_code' => 'required|min:1',
                'other_guest_'.($i + 1).'_city' => 'required|min:1',
                'other_guest_'.($i + 1).'_country' => 'required|min:2',
                'other_guest_'.($i + 1).'_phone' => '',
                'other_guest_'.($i + 1).'_email' => '',
                'other_guest_'.($i + 1).'_nif' => '',
                'other_guest_'.($i + 1).'_gender' => 'required',
                'other_guest_'.($i + 1).'_doc' => 'required',
                'other_guest_'.($i + 1).'_doc_number' => 'required',
                'other_guest_'.($i + 1).'_doc_number_id_control' => '',
                'other_guest_'.($i + 1).'_doc_date' => '',
                'other_guest_'.($i + 1).'_doc_valid' => '',
                'other_guest_'.($i + 1).'_doc_local' => '',
                'other_guest_'.($i + 1).'_doc_country' => 'required',
                'other_guest_'.($i + 1).'_doc_by' => '',
                'other_guest_'.($i + 1).'_birth_local' => 'required',
                'other_guest_'.($i + 1).'_birth_date' => 'required|date',
            ]);
            if ($validator->fails()) {
                $errors->merge($validator->getMessageBag());
            }
        }

        $validator = Validator::make($request->all(), [
            'verify_info' => 'required',
            'privacy_and_data_protection_policy' => 'required',
        ]);

        if ($validator->fails()) {
            $errors->merge($validator->getMessageBag());
        }

        if ($errors->count() > 0) {
            return back()->withErrors($errors)->withInput();
        }

        // Find guest
        $guest = Guest::where('code', $request->main_guest_0_code)->first();
        // update guest info
        $guest->name = $request->main_guest_0_name;
        $guest->last_name = $request->main_guest_0_last_name;
        $guest->address1 = $request->main_guest_0_address1;
        $guest->address2 = $request->main_guest_0_address2;
        $guest->address3 = $request->main_guest_0_address3;
        $guest->zip_code = $request->main_guest_0_zip_code;
        $guest->city = $request->main_guest_0_city;
        $guest->country = $request->main_guest_0_country;
        $guest->phone = $request->main_guest_0_phone;
        $guest->email = $request->main_guest_0_email;
        $guest->nif = $request->main_guest_0_nif;
        $guest->gender = $request->main_guest_0_gender;
        $guest->doc = $request->main_guest_0_doc;
        $guest->doc_number = $request->main_guest_0_doc_number;
        $guest->doc_number_id_control = $request->main_guest_0_doc_number_id_control;
        $guest->doc_date = $request->main_guest_0_doc_date;
        $guest->doc_valid = $request->main_guest_0_doc_valid;
        $guest->doc_local = $request->main_guest_0_doc_local;
        $guest->doc_country = $request->main_guest_0_doc_country;
        $guest->doc_by = $request->main_guest_0_doc_by;
        $guest->birth_local = $request->main_guest_0_birth_local;
        $guest->birth_date = $request->main_guest_0_birth_date;
        $guest->has_changes = true;
        $guest->save();

        // create or update other guests
        for ($i = 0; $i < $checkIn->adults + $checkIn->children + $checkIn->babies - 1; ++$i) {
            if ($request->has('other_guest_'.($i + 1).'_ignore')) {
                continue;
            }

            $extra = GuestExtra::where('code', $request->input('other_guest_'.($i + 1).'_code'))
                ->where('code', '!=', null)
                ->where('reservation_id', $checkIn->id)
                ->first() ?? new GuestExtra();

            $extra->reservation_id = $checkIn->id;
            $extra->code = $request->input('other_guest_'.($i + 1).'_code');
            $extra->name = $request->input('other_guest_'.($i + 1).'_name');
            $extra->last_name = $request->input('other_guest_'.($i + 1).'_last_name');
            $extra->address1 = $request->input('other_guest_'.($i + 1).'_address1');
            $extra->address2 = $request->input('other_guest_'.($i + 1).'_address2');
            $extra->address3 = $request->input('other_guest_'.($i + 1).'_address3');
            $extra->zip_code = $request->input('other_guest_'.($i + 1).'_zip_code');
            $extra->city = $request->input('other_guest_'.($i + 1).'_city');
            $extra->country = $request->input('other_guest_'.($i + 1).'_country');
            $extra->phone = $request->input('other_guest_'.($i + 1).'_phone');
            $extra->email = $request->input('other_guest_'.($i + 1).'_email');
            $extra->nif = $request->input('other_guest_'.($i + 1).'_nif');
            $extra->gender = $request->input('other_guest_'.($i + 1).'_gender');
            $extra->doc = $request->input('other_guest_'.($i + 1).'_doc');
            $extra->doc_number = $request->input('other_guest_'.($i + 1).'_doc_number');
            $extra->doc_number_id_control = $request->input('other_guest_'.($i + 1).'_doc_number_id_control');
            $extra->doc_date = $request->input('other_guest_'.($i + 1).'_doc_date');
            $extra->doc_valid = $request->input('other_guest_'.($i + 1).'_doc_valid');
            $extra->doc_local = $request->input('other_guest_'.($i + 1).'_doc_local');
            $extra->doc_country = $request->input('other_guest_'.($i + 1).'_doc_country');
            $extra->doc_by = $request->input('other_guest_'.($i + 1).'_doc_by');
            $extra->birth_local = $request->input('other_guest_'.($i + 1).'_birth_local');
            $extra->birth_date = $request->input('other_guest_'.($i + 1).'_birth_date');
            $extra->nationality = $request->input('other_guest_'.($i + 1).'_nationality');
            $extra->type = $request->input('other_guest_'.($i + 1).'_type');
            $extra->save();

            Log::debug($extra);
        }

        // set check in complete
        $checkIn->checkin_success = true;
        $checkIn->save();

        return redirect()->route('checkin.done', ['uuid' => $checkIn->uuid]);
    }

    public function done($uuid)
    {
        return view('checkin.done', [
            'reservation' => Reservation::where('uuid', $uuid)->first(),
        ]);
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
     * Show the form for editing the specified resource.
     *
     * @param string $uuid
     *
     * @return \Illuminate\Http\Response
     */
    public function edit($uuid)
    {
        $reservation = Reservation::where('uuid', $uuid)->first();

        if (!$reservation) {
            // TODO: show error page
            dd('nao existe');
        }

        if ($reservation->status != ReservationStatusKeysEnum::RESERVED) {
            // TODO: show error page
            dd('Não está em reserva');
        }

        return view('checkin.edit', [
            'reservation' => $reservation,
            'countries' => Country::all(),
        ]);
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
