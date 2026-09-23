<?php

namespace App\Http\Controllers;

use App\Models\Translation;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class TranslationController extends Controller
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
            'key' => ['required', Rule::unique('translations', 'key')->where('language_id', $request->language_id)],
            'value' => 'required',
            'language_id' => 'required',
        ]);

        // create a new translation
        Translation::create($request->all());
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
            'key' => ['required', Rule::unique('translations', 'key')
            ->where('language_id', $request->language_id)
            ->ignore($id), ],
            'value' => 'required',
            'language_id' => 'required',
        ]);

        // update the translation
        Translation::find($id)->update($request->all());
    }

    /**
     * Remove the specified resource from storage.
     *
     * @return \Illuminate\Http\Response
     */
    public function destroy($id)
    {
        // delete the translation
        Translation::find($id)->delete();
    }
}
