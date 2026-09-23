<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class UserController extends Controller
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
            'name' => 'required',
            'email' => 'required|email|unique:users,email',
            'password' => 'required',
        ]);

        // create a new user
        $user = new User(
            [
                'name' => $request->name,
                'email' => $request->email,
                'password' => Hash::make($request->password),
                'is_admin' => $request->has('is_admin'),
                'email_quiz_response' => $request->has('email_quiz_response'),
                'email_check_in_response' => $request->has('email_check_in_response'),
                'notify_guest_no_mail' => $request->has('notify_guest_no_mail'),
                'notify_guest_invalid_mail' => $request->has('notify_guest_invalid_mail'),
            ]
        );

        // set user units access
        if ($request->has('units')) {
            $user->setUnits($request->units);
        }

        // save the user
        $user->save();

        // set user mail as verified
        $user->markEmailAsVerified();

        // send user welcome mail
        $user->sendWelcomeMail();
    }

    /**
     * Show the form for editing the specified resource.
     *
     * @param int $id
     *
     * @return \Illuminate\Http\Response
     */
    public function edit($id)
    {
        // get the user
        $user = User::find($id);

        // return the view
        return view('users.edit', compact('user'));
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
        // validate the request
        $this->validate($request, [
            'name' => 'required',
            'email' => ['required', 'email', Rule::unique('users', 'email')->ignore($id)],
        ]);

        // get the user
        $user = User::find($id);

        // update the user
        $user->name = $request->name;
        $user->email = $request->email;
        $user->password = $request->password;
        $user->is_admin = $request->has('is_admin');
        $user->email_quiz_response = $request->has('email_quiz_response');
        $user->email_check_in_response = $request->has('email_check_in_response');
        $user->notify_guest_no_mail = $request->has('notify_guest_no_mail');
        $user->notify_guest_invalid_mail = $request->has('notify_guest_invalid_mail');

         // set user units access
         if ($request->has('units')) {
            $user->setUnits($request->units);
        }

        // save the user
        $user->save();
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
        // get the user
        $user = User::find($id);

        // check if the user is the last admin
        if ($user->is_admin && User::where('is_admin', true)->count() == 1) {
            return back()->withErrors(['errors' => 'You can not delete the last admin']);
        }

        // delete the user
        $user->delete();
    }
}
