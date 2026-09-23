<?php

namespace App\Mail;

use App\Models\Reservation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Queue\SerializesModels;

class NotifyAdminsNewQuizResponseMail extends Mailable
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
        return $this->view('mail.notify_admin_new_quiz_response', [
            'reservation' => $this->reservation,
        ])
        ->subject('Resposta a Questionario');
    }
}
