<?php

namespace App\Http\Livewire;

use App\Helpers\EventKeysEnum;
use App\Helpers\TranslationKeysEnum;
use App\Models\Event;
use App\Models\Language;
use App\Models\Translation;
use Livewire\Component;

class FrmConfigTexts extends Component
{
    public $email_subject;
    public $email_subject_modal;
    public $email_text;
    public $email_text_modal;
    public $btn_text;
    public $btn_text_modal;
    public $page_text;
    public $page_text_modal;
    public $page_submission_text;
    public $page_submission_text_modal;

    public $privacy_title;
    public $privacy_text;
    public $data_protection_title;
    public $data_protection_text;

    public $true_data_text;

    public $events;

    public $selected_event;
    public $selected_event_name;

    protected $listeners = [
        'eventChanged' => 'onEventChange',
    ];

    protected $rules = [
        'selected_event' => 'required',
    ];

    public function mount()
    {
        $this->events = Event::all();
        // $this->selected_event = $this->events[0]->code;
        // $this->onEventChange('');
    }

    public function getEventName()
    {
        $this->selected_event_name = Event::where('code', $this->selected_event)->first()->description ?? 'Outros Textos';
    }

    public function render()
    {
        return view('livewire.frm-config-texts');
    }

    public function onEventChange($event_code = null)
    {
        $this->true_data_text = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA)->first()->value;

        $this->privacy_title = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE)->first()->value;
        $this->privacy_text = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT)->first()->value;

        $this->data_protection_title = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE)->first()->value;
        $this->data_protection_text = Translation::where('key', TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT)->first()->value;

        if (!$event_code) {
            $event_code = $this->selected_event;
        }

        // dd($event_code);
        $this->selected_event = $event_code;

        $this->getEventName();

        $lang_id = Language::where('code', 'PT')->first()->id;

        switch ($this->selected_event) {
            case EventKeysEnum::BIRTHDAY:
                $this->email_subject_modal = 'modal-update-birthday-email-subject';
                $this->email_text_modal = 'modal-update-birthday-email-text';
                $this->email_subject = Translation::where('key', TranslationKeysEnum::BIRTHDAY_MAIL_SUBJECT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->email_text = Translation::where('key', TranslationKeysEnum::BIRTHDAY_MAIL_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;
                break;

            case EventKeysEnum::CHECKIN:
                $this->email_subject_modal = 'modal-update-checkin-email-subject';
                $this->email_text_modal = 'modal-update-checkin-email-text';
                $this->btn_text_modal = 'modal-update-checkin-btn-text';
                $this->page_text_modal = 'modal-update-checkin-page-text';
                $this->page_submission_text_modal = 'modal-update-checkin-page-submission-text';

                $this->page_submission_text = Translation::where('key', TranslationKeysEnum::CHECKIN_PAGE_SUBMISSION_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->email_subject = Translation::where('key', TranslationKeysEnum::CHECKIN_MAIL_SUBJECT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->email_text = Translation::where('key', TranslationKeysEnum::CHECKIN_EMAIL_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->btn_text = Translation::where('key', TranslationKeysEnum::BTN_CHECKIN)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->page_text = Translation::where('key', TranslationKeysEnum::CHECKIN_PAGE_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;
                break;

            case EventKeysEnum::QUIZ:
                $this->email_subject_modal = 'modal-update-quiz-email-subject';
                $this->email_text_modal = 'modal-update-quiz-email-text';
                $this->btn_text_modal = 'modal-update-quiz-btn-text';
                $this->page_text_modal = 'modal-update-quiz-page-text';
                $this->page_submission_text_modal = 'modal-update-quiz-page-submission-text';

                $this->page_submission_text = Translation::where('key', TranslationKeysEnum::QUIZ_PAGE_SUBMISSION_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->email_subject = Translation::where('key', TranslationKeysEnum::QUIZ_MAIL_SUBJECT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->email_text = Translation::where('key', TranslationKeysEnum::QUIZ_MAIL_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->btn_text = Translation::where('key', TranslationKeysEnum::BTN_QUIZ)
                ->where('language_id', $lang_id)
                ->first()
                ->value;

                $this->page_text = Translation::where('key', TranslationKeysEnum::QUIZ_PAGE_TEXT)
                ->where('language_id', $lang_id)
                ->first()
                ->value;
                break;

                case EventKeysEnum::PROMO:
                    $this->email_subject_modal = 'modal-update-promo-email-subject';
                    $this->email_text_modal = 'modal-update-promo-email-text';
                    $this->email_subject = Translation::where('key', TranslationKeysEnum::PROMO_MAIL_SUBJECT)
                    ->where('language_id', $lang_id)
                    ->first()
                    ->value;

                    $this->email_text = Translation::where('key', TranslationKeysEnum::PROMO_MAIL_TEXT)
                    ->where('language_id', $lang_id)
                    ->first()
                    ->value;
                    break;

            default:
                // code...
                break;
        }
    }

    public function save()
    {
    }
}
