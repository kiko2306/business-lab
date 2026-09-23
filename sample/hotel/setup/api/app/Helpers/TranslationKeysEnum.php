<?php

namespace App\Helpers;

class TranslationKeysEnum
{
    public const NEW_USER_WELCOME_MAIL_TEXT = 'NEW_USER_WELCOME_MAIL_TEXT';

    // Birthday
    public const BIRTHDAY_MAIL_SUBJECT = 'BIRTHDAY_MAIL_SUBJECT';
    public const BIRTHDAY_MAIL_TEXT = 'BIRTHDAY_MAIL_TEXT';

    // Questionarios
    public const QUIZ_MAIL_SUBJECT = 'QUIZ_MAIL_SUBJECT';
    public const QUIZ_MAIL_TEXT = 'QUIZ_MAIL_TEXT';
    public const QUIZ_PAGE_TEXT = 'QUIZ_PAGE_TEXT';
    public const BTN_QUIZ = 'BTN_QUIZ';
    public const QUIZ_PAGE_SUBMISSION_TEXT = 'QUIZ_PAGE_SUBMISSION_TEXT';

    // Checkin
    public const CHECKIN_MAIL_SUBJECT = 'CHECKIN_MAIL_SUBJECT';
    public const CHECKIN_EMAIL_TEXT = 'CHECKIN_EMAIL_TEXT';
    public const CHECKIN_PAGE_TEXT = 'CHECKIN_PAGE_TEXT';
    public const BTN_CHECKIN = 'BTN_CHECKIN';
    public const CHECKIN_PAGE_SUBMISSION_TEXT = 'CHECKIN_PAGE_SUBMISSION_TEXT';

    // Birthday
    public const PROMO_MAIL_SUBJECT = 'PROMO_MAIL_SUBJECT';
    public const PROMO_MAIL_TEXT = 'PROMO_MAIL_TEXT';

    // footer
    public const DECLARE_CHECKIN_TRUE_DATA = 'DECLARE_CHECKIN_TRUE_DATA';
    public const DECLARE_CHECKIN_TERMS_READ = 'DECLARE_CHECKIN_TERMS_READ';
    public const DECLARE_CHECKIN_POLICY_READ_TITLE = 'DECLARE_CHECKIN_POLICY_READ_TITLE';
    public const DECLARE_CHECKIN_POLICY_READ_TEXT = 'DECLARE_CHECKIN_POLICY_READ_TEXT';
    public const DECLARE_CHECKIN_DATA_PROTECTION_TITLE = 'DECLARE_CHECKIN_DATA_PROTECTION_TITLE';
    public const DECLARE_CHECKIN_DATA_PROTECTION_TEXT = 'DECLARE_CHECKIN_DATA_PROTECTION_TEXT';

    // checkin form
    public const MAIN_GUEST = 'MAIN_GUEST';
    public const OTHER_GUESTS = 'OTHER_GUESTS';

    public const NAME = 'NAME';
    public const LAST_NAME = 'LAST_NAME';
    public const ADDRESS = 'ADDRESS';
    public const ZIP_CODE = 'ZIP_CODE';
    public const CITY = 'CITY';
    public const NATIONALITY = 'NATIONALITY';
    public const COUNTRY = 'COUNTRY';
    public const PHONE = 'PHONE';
    public const EMAIL = 'EMAIL';
    public const VAT = 'VAT';
    public const GENDER_MALE = 'GENDER_MALE';
    public const GENDER_FEMALE = 'GENDER_FEMALE';
    public const AGE_GROUP = 'AGE_GROUP';
    public const AGE_GROUP_ADULT = 'AGE_GROUP_ADULT';
    public const AGE_GROUP_CHILD = 'AGE_GROUP_CHILD';
    public const AGE_GROUP_BABY = 'AGE_GROUP_BABY';
    public const CARD_TYPE = 'CARD_TYPE';
    public const CARD_TYPE_ID = 'CARD_TYPE_ID';
    public const CARD_TYPE_PASSPORT = 'CARD_TYPE_PASSPORT';
    public const CARD_TYPE_RESIDENCE = 'CARD_TYPE_RESIDENCE';
    public const CARD_TYPE_DRIVING = 'CARD_TYPE_DRIVING';
    public const CARD_TYPE_CITIZEN = 'CARD_TYPE_CITIZEN';
    public const CARD_TYPE_REFUGEE = 'CARD_TYPE_REFUGEE';
    public const ID_CARD_NUMBER = 'ID_CARD_NUMBER';
    public const ID_CARD_NUMBER_CONTROL = 'ID_CARD_NUMBER_CONTROL';
    public const ISSUED_ON = 'ISSUED_ON';
    public const VALID_UNTIL = 'VALID_UNTIL';
    public const PLACE_ISSUE = 'PLACE_ISSUE';
    public const COUNTRY_ISSUE = 'COUNTRY_ISSUE';
    public const ISSUE_BY = 'ISSUE_BY';
    public const BIRTH_PLACE = 'BIRTH_PLACE';
    public const BIRTH_DATE = 'BIRTH_DATE';
    public const REQUIRED = 'REQUIRED';
    public const IGNORE = 'IGNORE';

    // dados da reserva
    public const RESERVATION_INFO_EMAIL_TITLE = 'RESERVATION_INFO_EMAIL_TITLE';
    public const GUEST = 'GUEST';
    public const CHECKIN = 'CHECKIN';
    public const CHECKOUT = 'CHECKOUT';
    public const UNIT = 'UNIT';
    public const OCCUPANTS = 'OCCUPANTS';
    public const RESERVATION = 'RESERVATION';

    public static function getRandomValue()
    {
        $values = [
            self::NEW_USER_WELCOME_MAIL_TEXT,

            self::QUIZ_MAIL_TEXT,
            self::QUIZ_MAIL_SUBJECT,
            self::QUIZ_PAGE_TEXT,
            self::BTN_QUIZ,

            self::CHECKIN_EMAIL_TEXT,
            self::CHECKIN_MAIL_SUBJECT,
            self::CHECKIN_PAGE_TEXT,
            self::BTN_CHECKIN,

            self::DECLARE_CHECKIN_TRUE_DATA,
        ];

        return $values[array_rand($values)];
    }
}
