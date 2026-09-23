<div class="mt-3 form-check">

    <input class="form-check-input" type="checkbox" value="1" id="ppd" name="privacy_and_data_protection_policy">

    <label class="form-check-label" for="privacy_and_data_protection_policy">
        <small>
            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TERMS_READ)) !!}
            <br>
            <a href="#" data-bs-toggle="modal" data-bs-target="#pppd-pt">
                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE)) !!}
            </a>
            &nbsp;&nbsp;&nbsp;
            <a href="#" data-bs-toggle="modal" data-bs-target="#pppd-pt2">
                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE)) !!}
            </a>
        </small>
    </label>

    @error('privacy_and_data_protection_policy')
    <span class="text-sm text-danger">
        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
    </span>
    @enderror

</div>

<div class="modal" id="pppd-pt" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">{!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TITLE) !!}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_POLICY_READ_TEXT) !!}
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
    </div>
</div>



<div class="modal" id="pppd-pt2" tabindex="-1">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
            <div class="modal-header">
                <h5 class="modal-title">{!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TITLE) !!}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
                {!! $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_DATA_PROTECTION_TEXT) !!}
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
    </div>
</div>
