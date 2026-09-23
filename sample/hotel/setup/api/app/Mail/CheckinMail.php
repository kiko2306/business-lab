<?php

namespace App\Mail;

use App\Helpers\TranslationKeysEnum;
use App\Models\Reservation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class CheckinMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    private Reservation $reservation;

    /**
     * Create a new message instance.
     *
     * @return void
     */
    public function __construct(Reservation $reservation)
    {
        $this->reservation = $reservation;
    }

    /**
     * Build the message.
     *
     * @return $this
     */
    public function build()
    {
        return $this->view('mail.guest-checkin-mail', [
            'reservation' => $this->reservation,
            'translation_key_text' => TranslationKeysEnum::CHECKIN_EMAIL_TEXT,
            'translation_key_btn' => TranslationKeysEnum::BTN_CHECKIN,
        ])->subject($this->reservation->guest->getTranslation(TranslationKeysEnum::CHECKIN_MAIL_SUBJECT));
    }
}
