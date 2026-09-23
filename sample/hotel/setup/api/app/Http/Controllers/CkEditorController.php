<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class CkEditorController extends Controller
{
    public function upload(Request $request)
    {
        if ($request->hasFile('upload')) {
            //get filename with extension
            $filenamewithextension = $request->file('upload')->getClientOriginalName();

            //get filename without extension
            $filename = pathinfo($filenamewithextension, PATHINFO_FILENAME);

            //get file extension
            $extension = $request->file('upload')->getClientOriginalExtension();

            //filename to store
            $filenametostore = $filename . '_' . time() . '.' . $extension;

            Log::debug('store 1');
            //Upload File
            $request->file('upload')->storeAs('public/uploads', $filenametostore);
            Log::debug('store 2');
            $request->file('upload')->storeAs('public/uploads/thumbnail', $filenametostore);


            Log::debug('resize');
            //Resize image here
            // $thumbnailpath = public_path('public/uploads/thumbnail/' . $filenametostore);
            // $img = Image::make($thumbnailpath)->resize(500, 150, function ($constraint) {
            //     $constraint->aspectRatio();
            // });
            // Log::debug('store 3');
            // $img->save($thumbnailpath);

            echo json_encode([
                'default' => asset('storage/uploads/' . $filenametostore),
                '500' => asset('storage/uploads/thumbnail/' . $filenametostore)
            ]);
        }
    }
}
