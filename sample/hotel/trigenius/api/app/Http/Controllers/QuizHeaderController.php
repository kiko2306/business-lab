<?php

namespace App\Http\Controllers;

use App\Models\QuizHeader;
use App\Http\Requests\StoreQuizHeaderRequest;
use App\Http\Requests\UpdateQuizHeaderRequest;

class QuizHeaderController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function index()
    {
        //
    }

    /**
     * Show the form for creating a new resource.
     *
     * @return \Illuminate\Http\Response
     */
    public function create()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     *
     * @param  \App\Http\Requests\StoreQuizHeaderRequest  $request
     * @return \Illuminate\Http\Response
     */
    public function store(StoreQuizHeaderRequest $request)
    {
        //
    }

    /**
     * Display the specified resource.
     *
     * @param  \App\Models\QuizHeader  $quizHeader
     * @return \Illuminate\Http\Response
     */
    public function show(QuizHeader $quizHeader)
    {
        //
    }

    /**
     * Show the form for editing the specified resource.
     *
     * @param  \App\Models\QuizHeader  $quizHeader
     * @return \Illuminate\Http\Response
     */
    public function edit(QuizHeader $quizHeader)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     *
     * @param  \App\Http\Requests\UpdateQuizHeaderRequest  $request
     * @param  \App\Models\QuizHeader  $quizHeader
     * @return \Illuminate\Http\Response
     */
    public function update(UpdateQuizHeaderRequest $request, QuizHeader $quizHeader)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     *
     * @param  \App\Models\QuizHeader  $quizHeader
     * @return \Illuminate\Http\Response
     */
    public function destroy(QuizHeader $quizHeader)
    {
        //
    }
}
