<div class="mt-3 form-check">

    <input class="form-check-input" type="checkbox" value="1" id="verify_info" name="verify_info">

    <label class="form-check-label" for="verify_info">
        <small>
            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::DECLARE_CHECKIN_TRUE_DATA)) !!}
        </small>
    </label>

    @error('verify_info')
    <span class="text-sm text-danger">
        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
    </span>
    @enderror

</div>
