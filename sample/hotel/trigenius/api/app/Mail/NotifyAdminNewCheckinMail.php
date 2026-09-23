<?php

namespace App\Mail;

use App\Models\Reservation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class NotifyAdminNewCheckinMail extends Mailable
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
        return $this->view('mail.notify-admin-new-check-in', [
            'reservation' => $this->reservation,
        ])->subject('Checkin Online efectuado');
    }
}
