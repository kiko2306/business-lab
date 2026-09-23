<?php

namespace App\Helpers;

use App\Models\User;

class NotifiableAdmins
{
    /**
     * Get User admins list for specific unit.
     */
    public static function invalidMail(int $unit_id): array
    {
        $allAdmins = User::all();

        $admins = [];

        foreach ($allAdmins as $admin) {
            if ($admin->units->contains('id', $unit_id) && $admin->notify_guest_invalid_mail) {
                $admins[] = $admin;
            }
        }

        return $admins;
    }

    public static function noMail(int $unit_id): array
    {
        $allAdmins = User::all();

        $admins = [];

        foreach ($allAdmins as $admin) {
            if ($admin->units->contains('id', $unit_id) && $admin->notify_guest_no_mail) {
                $admins[] = $admin;
            }
        }

        return $admins;
    }

    public static function quizResponse(int $unit_id): array
    {
        $allAdmins = User::all();
        $admins = [];

        foreach ($allAdmins as $admin) {
            // if (!$admin->units) {
            //     continue;
            // }
            if ($admin->units->contains('id', $unit_id) && $admin->email_quiz_response) {
                $admins[] = $admin;
            }
        }

        return $admins;
    }

    public static function newCheckin(int $unit_id): array
    {
        $allAdmins = User::all();
        $admins = [];

        foreach ($allAdmins as $admin) {
            if ($admin->units->contains('id', $unit_id) && $admin->email_check_in_response) {
                $admins[] = $admin;
            }
        }

        return $admins;
    }

    public static function serviceConnectionDelay()
    {
        $allAdmins = User::all();

        $admins = [];

        foreach ($allAdmins as $admin) {
            if ($admin->notify_service_connection_delay) {
                $admins[] = $admin;
            }
        }

        return $admins;
    }
}
