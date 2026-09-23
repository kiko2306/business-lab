<?php

namespace App\Helpers;

class ReservationStatusKeysEnum
{
    public const CHECKIN = 'CKI';
    public const CHECKOUT = 'CKO';
    public const CANCELLED = 'CAN';
    public const RESERVED = 'RSV';
    public const NEGATED = 'NEG';
    public const NO_SHOW = 'NSW';
    public const OVER_BOOKING = 'OVB';
    public const WAITING_LIST = 'LTE';
    public const OPTION = 'ECF';

    public static function getRandomValue()
    {
        $values = [
            self::CHECKIN,
            self::CHECKOUT,
            self::CANCELLED,
            self::RESERVED,
            self::NEGATED,
            self::NO_SHOW,
            self::OVER_BOOKING,
            self::WAITING_LIST,
            self::OPTION,
        ];

        return $values[array_rand($values)];
    }

    public static function getKey($value)
    {
        switch ($value) {
            case self::CHECKIN:
                return 'Checkin';
            case self::CHECKOUT:
                return 'Checkout';
            case self::CANCELLED:
                return 'Cancelled';
            case self::RESERVED:
                return 'Reserved';
            case self::NEGATED:
                return 'Negated';
            case self::NO_SHOW:
                return 'No Show';
            case self::OVER_BOOKING:
                return 'Over Booking';
            case self::WAITING_LIST:
                return 'Waiting List';
            case self::OPTION:
                return 'Option';
            default:
                return 'Unknown';
        }
    }
}
