<?php

namespace App\Mail;

use App\Models\Reservation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class NotifyAdminGuestWithInvalidMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    protected Reservation $reservation;

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
        return $this->view('mail.notify-admin-guest_with_invalid_mail', [
            'reservation' => $this->reservation,
        ])
            ->subject('Hóspede com email invalido!');
    }
}
