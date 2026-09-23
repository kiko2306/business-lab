<?php

namespace App\Http\Controllers;

use App\Models\Unit;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class UnitController extends Controller
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
        // validate the request
        $this->validate($request, [
            'code' => 'required|string|max:255|unique:units,code',
            'name' => 'required|string|max:255',
        ]);

        // create a new unit
        Unit::create($request->all());
    }

    /**
     * Show the form for editing the specified resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function edit($id)
    {
    }

    /**
     * Update the specified resource in storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function update(Request $request, $id)
    {
        // validate the request
        $this->validate($request, [
            'code' => ['required', 'string', 'max:255', Rule::unique('units', 'code')->ignore($id)],
            'name' => 'required|string|max:255',
        ]);

        // update the unit
        Unit::find($id)->update($request->all());
    }

    /**
     * Remove the specified resource from storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function destroy($id)
    {
        // delete the unit
        Unit::destroy($id);
    }
}
