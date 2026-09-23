<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;

class GuestExtra extends Model
{
    use HasFactory;

    protected $fillable = [
        'reservation_id',
        'code',
        'name',
        'last_name',
        'address1',
        'address2',
        'address3',
        'zip_code',
        'city',
        'country',
        'phone',
        'email',
        'nif',
        'gender',
        'doc',
        'doc_number',
        'doc_number_id_control',
        'doc_date',
        'doc_valid',
        'doc_local',
        'doc_country',
        'doc_by',
        'birth_local',
        'birth_date',
        'nationality',
    ];

    public static function add($id, $list)
    {
        foreach ($list as $guest) {
            $guest_data = Guest::where('code', $guest['code'])->first();

            if (!$guest_data) {
                continue;
            }

            $extra = new GuestExtra([
                'reservation_id' => $id,
                'code' => $guest['code'],
                'name' => $guest_data->name,
                'last_name' => $guest_data->last_name,
                'address1' => $guest_data->address1,
                'address2' => $guest_data->address2,
                'address3' => $guest_data->address3,
                'zip_code' => $guest_data->zip_code,
                'city' => $guest_data->city,
                'country' => $guest_data->country,
                'phone' => $guest_data->phone,
                'email' => $guest_data->email,
                'nif' => $guest_data->nif,
                'gender' => $guest_data->gender,
                'doc' => $guest_data->doc,
                'doc_number' => $guest_data->doc_number,
                'doc_number_id_control' => $guest_data->doc_number_id_control,
                'doc_date' => $guest_data->doc_date,
                'doc_valid' => $guest_data->doc_valid,
                'doc_local' => $guest_data->doc_local,
                'doc_country' => $guest_data->doc_country,
                'doc_by' => $guest_data->doc_by,
                'birth_local' => $guest_data->birth_local,
                'birth_date' => $guest_data->birth_date,
                'nationality' => $guest_data->nationality,
            ]);

            //Log::debug($extra);

            $extra->save();
        }
    }
}
