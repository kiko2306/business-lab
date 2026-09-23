<?php

namespace App\Http\Controllers;

use App\Models\Event;
use Illuminate\Http\Request;

class EventController extends Controller
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
     * Show the form for editing the specified resource.
     *
     * @param \App\Models\Event $event
     *
     * @return \Illuminate\Http\Response
     */
    public function edit($id)
    {
    }

    /**
     * Update the specified resource in storage.
     *
     * @param \App\Models\Event $event
     *
     * @return \Illuminate\Http\Response
     */
    public function update(Request $request, $id)
    {
        // validate the data
        $this->validate($request, [
            'code' => 'required|string|max:255',
            'name' => 'required|string|max:255',
            'description' => 'required|string|max:255',
            'hours' => 'integer|min:0|max:23',
            'days_offset' => 'integer|min:-5|max:5',
        ]);

        // get event and update
        $event = Event::find($id);

        $event->update([
            'hours' => $request->hours,
            'days_offset' => $request->days_offset,
        ]);

        // update active status
        if ($request->has('active')) {
            $event->is_active = true;
        } else {
            $event->is_active = false;
        }

        // update active status
        $event->save();
    }
}
