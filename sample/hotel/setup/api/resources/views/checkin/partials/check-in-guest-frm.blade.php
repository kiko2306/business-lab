<div class="p-3 mb-3 shadow card">

    <div class="accordion-item">
        <h2 class="accordion-header" id="{{ $prefix }}_{{ $n }}_title">
            <button class="pb-0 mb-0 accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#{{ $prefix }}_{{ $n }}_data" aria-expanded="false"
                aria-controls="{{ $prefix }}_{{ $n }}_data">
                <span>
                    {!! $title !!}
                    <span>
                        @if($n > 0)
                        {{ $n }} &nbsp;
                        @endif
                    </span>
                </span>
                <span class="ml-1 text-sm text-danger">
                    {{ $errors->has($prefix.'_'.$n.'*') ? '('.count($errors->get($prefix.'_'.$n.'*')) . ' errors' . ')' : '' }}
                </span>
            </button>

            @if($n > 0 && !$guest->name)
            <div class="text-sm form-check text-muted mt-2" style="margin-left: 20px">
                <input type="checkbox" class="form-check-input" name="{{ $prefix }}_{{ $n }}_ignore" id="{{ $prefix }}_{{ $n }}_ignore" value="1">
                <label for="{{ $prefix }}_{{ $n }}_ignore" class="text-danger">
                    {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::IGNORE)) !!}
                </label>
            </div>
            @endif
        </h2>
        @if ($guest->name)
        <div class="text-center">
            <span class="text-sm text-primary">
                ( {{ $guest->name }} {{ $guest->last_name }} )
            </span>
        </div>
        @endif
        <div id="{{ $prefix }}_{{ $n }}_data" class="accordion-collapse collapse" aria-labelledby="{{ $prefix }}_{{ $n }}_title" data-bs-parent="#accordion_checkin">

            <div class="accordion-body">

                <input type="hidden" name="{{ $prefix }}_{{ $n }}_code" value="{{ $guest->code }}">
                <input type="hidden" name="{{ $prefix }}_{{ $n }}_uuid" value="{{ $reservation->uuid }}">

                {{-- Name --}}
                <div class="form-group">
                    <label for="{{ $prefix }}_{{ $n }}_name">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::NAME)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_name" name="{{ $prefix }}_{{ $n }}_name"
                        placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}" value="{{ old($prefix.'_'.$n.'_name', $guest->name) }}">
                    @error($prefix.'_'.$n.'_name')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Last Name --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_last_name">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::LAST_NAME)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_last_name" name="{{ $prefix }}_{{ $n }}_last_name"
                        placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}"
                        value="{{ old($prefix.'_'.$n.'_last_name', $guest->last_name) }}">
                    @error($prefix.'_'.$n.'_last_name')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Address --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_address1">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ADDRESS)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_address1" name="{{ $prefix }}_{{ $n }}_address1"
                        placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}" value="{{ old($prefix.'_'.$n.'_address1',$guest->address1) }}">
                    <input type="text" class="mt-1 form-control" id="{{ $prefix }}_{{ $n }}_address2" name="{{ $prefix }}_{{ $n }}_address2"
                        value="{{ old($prefix.'_'.$n.'_address2',$guest->address2) }}">
                    <input type="text" class="mt-1 form-control" id="{{ $prefix }}_{{ $n }}_address3" name="{{ $prefix }}_{{ $n }}_address3"
                        value="{{ old($prefix.'_'.$n.'_address3',$guest->address3) }}">
                    @error($prefix.'_'.$n.'_address1')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Zip-Code --}}
                <div class="mt-3 form-group">
                    <div class="row">
                        <div class="col-md-6 col-sm-12">
                            <label for="{{ $prefix }}_{{ $n }}_zip_code">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ZIP_CODE)) !!}
                            </label>
                            <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_zip_code" name="{{ $prefix }}_{{ $n }}_zip_code"
                                placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}"
                                value="{{ old($prefix.'_'.$n.'_zip_code', $guest->zip_code) }}">
                        </div>
                        <div class="col-md-6 col-sm-12">
                            <label for="{{ $prefix }}_{{ $n }}_city">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CITY)) !!}
                            </label>
                            <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_city" name="{{ $prefix }}_{{ $n }}_city"
                                placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}"
                                value="{{ old($prefix.'_'.$n.'_city', $guest->city)  }}">
                        </div>
                    </div>
                    @error($prefix.'_'.$n.'_zip_code')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ZIP_CODE)) !!}
                        /
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                    @error($prefix.'_'.$n.'_city')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CITY)) !!}
                        /
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Nationality --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_nationality">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::NATIONALITY)) !!}
                        @if(!$guest->nationality)
                        <span class="text-muted">
                            ( {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!} )
                        </span>
                        @endif
                    </label>
                    <select class="form-select" name="{{ $prefix }}_{{ $n }}_nationality">
                        <option value="{{ $guest->nationality }}">
                            {{ old($prefix.'_'.$n.'_nationality', $guest->nationality) }}
                        </option>
                        @foreach ($countries as $country)
                        <option value="{{ $country->code }}">
                            {{ $country->code }} - {{ $country->name }}
                        </option>
                        @endforeach
                    </select>
                    @error($prefix.'_'.$n.'_nationality')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Country --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_country">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::COUNTRY)) !!}
                        @if(!$guest->country)
                        <span class="text-muted">
                            ( {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!} )
                        </span>
                        @endif
                    </label>
                    <select class="form-select" name="{{ $prefix }}_{{ $n }}_country">
                        <option value="{{ $guest->country }}">
                            {{ old($prefix.'_'.$n.'_country', $guest->country) }}
                        </option>
                        @foreach ($countries as $country)
                        <option value="{{ $country->code }}">
                            {{ $country->code }} - {{ $country->name }}
                        </option>
                        @endforeach
                    </select>
                    @error($prefix.'_'.$n.'_country')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Phone --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_phone">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::PHONE)) !!}
                    </label>
                    <input type="number" class="form-control" id="{{ $prefix }}_{{ $n }}_phone" name="{{ $prefix }}_{{ $n }}_phone" value="{{ old($prefix.'_'.$n.'_phone', $guest->phone) }}">
                </div>

                {{-- Email --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_email">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::EMAIL)) !!}
                    </label>
                    <input type="email" class="form-control" id="{{ $prefix }}_{{ $n }}_email" name="{{ $prefix }}_{{ $n }}_email" value="{{ old($prefix.'_'.$n.'_email', $guest->email) }}">
                    @error($prefix.'_'.$n.'_email')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- VAT --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_nif">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::VAT)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_nif" name="{{ $prefix }}_{{ $n }}_nif" value="{{ old($prefix.'_'.$n.'_nif', $guest->nif) }}">
                    @error($prefix.'_'.$n.'_nif')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- GENDER --}}
                <div class="mt-3 form-group">
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="radio" name="{{ $prefix }}_{{ $n }}_gender" id="inlineRadioGender1" value="1" @if ($guest->gender == 1) checked @endif>
                        <label class="form-check-label" for="inlineRadioGender1">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::GENDER_MALE)) !!}
                        </label>
                    </div>
                    <div class="form-check form-check-inline">
                        <input class="form-check-input" type="radio" name="{{ $prefix }}_{{ $n }}_gender" id="inlineRadioGender2" value="0" @if ($guest->gender == 0) checked @endif>
                        <label class="form-check-label" for="inlineRadioGender2">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::GENDER_FEMALE)) !!}
                        </label>
                    </div>
                    @error($prefix.'_'.$n.'_gender')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Age Group --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_type">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::AGE_GROUP)) !!}
                    </label>
                    <select name="{{ $prefix }}_{{ $n }}_type" class="form-select">
                        <option value="0">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::AGE_GROUP_ADULT)) !!}
                        </option>
                        <option value="1">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::AGE_GROUP_CHILD)) !!}
                        </option>
                        <option value="2">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::AGE_GROUP_BABY)) !!}
                        </option>
                    </select>
                </div>

                <hr>

                {{-- ID Doc --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_doc">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE)) !!}
                    </label>
                    <select class="form-select" id="{{ $prefix }}_{{ $n }}_doc" name="{{ $prefix }}_{{ $n }}_doc">
                        <option value="1" @if ($guest->doc === 1) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_ID)) !!}
                        </option>
                        <option value="2" @if ($guest->doc === 2) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_PASSPORT)) !!}
                        </option>
                        <option value="3" @if ($guest->doc === 3) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_RESIDENCE)) !!}
                        </option>
                        <option value="4" @if ($guest->doc === 4) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_DRIVING)) !!}
                        </option>
                        <option value="5" @if ($guest->doc === 5) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_CITIZEN)) !!}
                        </option>
                        <option value="6" @if ($guest->doc === 6) selected @endif>
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::CARD_TYPE_REFUGEE)) !!}
                        </option>
                    </select>
                </div>

                {{-- ID Doc Number --}}
                <div class="mt-3 row">
                    <div class="col-md-6 col-sm-12">
                        <div class="form-group">
                            <label for="{{ $prefix }}_{{ $n }}_doc_number">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER)) !!}
                            </label>
                            <input type="text" id="{{ $prefix }}_{{ $n }}_doc_number" name="{{ $prefix }}_{{ $n }}_doc_number" class="form-control"
                                placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}"
                                value="{{ old($prefix.'_'.$n.'_doc_number', $guest->doc_number) }}">
                            @error($prefix.'_'.$n.'_doc_number')
                            <span class="text-sm text-danger">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                            </span>
                            @enderror
                        </div>
                    </div>
                    <div class="col-md-6 col-sm-12">
                        <div class="form-group">
                            <label for="{{ $prefix }}_{{ $n }}_doc_number_id_control">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ID_CARD_NUMBER_CONTROL)) !!}
                            </label>
                            <input type="text" id="{{ $prefix }}_{{ $n }}_doc_number_id_control" name="{{ $prefix }}_{{ $n }}_doc_number_id_control" class="form-control"
                                value="{{ old($prefix.'_'.$n.'_doc_number_id_control', $guest->doc_number_id_control) }}">
                            @error($prefix.'_'.$n.'_doc_number_id_control')
                            <span class="text-sm text-danger">
                                {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                            </span>
                            @enderror
                        </div>
                    </div>
                </div>

                {{-- ID Doc Date --}}
                <div class="mt-3 row">
                    <div class="col-md-6 col-sm-12">
                        <label for="{{ $prefix }}_{{ $n }}_doc_date">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ISSUED_ON)) !!}
                        </label>
                        <input type="date" id="{{ $prefix }}_{{ $n }}_doc_date" name="{{ $prefix }}_{{ $n }}_doc_date" class="form-control"
                            value="{{ old($prefix.'_'.$n.'_doc_date', \Carbon\Carbon::parse($guest->doc_date)->format('Y-m-d')) }}">

                        @error($prefix.'_'.$n.'_doc_date')
                        <span class="text-sm text-danger">
                            {!! strip_tags( $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                        </span>
                        @enderror
                    </div>
                    <div class="col-md-6 col-sm-12">
                        <label for="{{ $prefix }}_{{ $n }}_doc_valid">
                            {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::VALID_UNTIL)) !!}
                        </label>
                        <input type="date" id="{{ $prefix }}_{{ $n }}_doc_valid" name="{{ $prefix }}_{{ $n }}_doc_valid" class="form-control"
                            value="{{ old($prefix.'_'.$n.'_doc_valid', \Carbon\Carbon::parse($guest->doc_valid)->format('Y-m-d')) }}">
                        @error($prefix.'_'.$n.'_doc_valid')
                        <span class="text-sm text-danger">
                            {!! strip_tags( $reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                        </span>
                        @enderror
                    </div>
                </div>

                {{-- ID Doc Issued By --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_doc_local">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::PLACE_ISSUE)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_doc_local" name="{{ $prefix }}_{{ $n }}_doc_local"
                        value="{{ old($prefix.'_'.$n.'_doc_local', $guest->doc_local) }}">
                </div>

                {{-- ID Doc Issued By Country--}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_doc_country">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::COUNTRY_ISSUE)) !!}
                        @if(!$guest->doc_country)
                        <span class="text-muted">
                            ( {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!} )
                        </span>
                        @endif
                    </label>
                    <select class="form-select" name="{{ $prefix }}_{{ $n }}_doc_country">
                        <option value="{{ $guest->doc_country }}">
                            {{ old($prefix.'_'.$n.'_doc_country', $guest->doc_country) }}
                        </option>
                        @foreach ($countries as $country)
                        <option value="{{ $country->code }}">
                            {{ $country->code }} - {{ $country->name }}
                        </option>
                        @endforeach
                    </select>
                    @error($prefix.'_'.$n.'_doc_country')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Issued By --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_doc_by">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::ISSUE_BY)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_doc_by" name="{{ $prefix }}_{{ $n }}_doc_by" value="{{ old($prefix.'_'.$n.'_doc_by', $guest->doc_by) }}">
                    @error($prefix.'_'.$n.'_doc_by')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                {{-- Birth place --}}
                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_birth_local">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::BIRTH_PLACE)) !!}
                    </label>
                    <input type="text" class="form-control" id="{{ $prefix }}_{{ $n }}_birth_local" name="{{ $prefix }}_{{ $n }}_birth_local"
                        placeholder="{!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}"
                        value="{{ old($prefix.'_'.$n.'_birth_local', $guest->birth_local) }}">
                    @error($prefix.'_'.$n.'_birth_local')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>

                <div class="mt-3 form-group">
                    <label for="{{ $prefix }}_{{ $n }}_birth_date">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::BIRTH_DATE)) !!}
                        @if(!$guest->birth_date)
                        <span class="text-muted">
                            ( {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!} )
                        </span>
                        @endif
                    </label>
                    <input type="date" class="form-control" id="{{ $prefix }}_{{ $n }}_birth_date" name="{{ $prefix }}_{{ $n }}_birth_date"
                        value="{{ old($prefix.'_'.$n.'_birth_date' ,\Carbon\Carbon::parse($guest->birth_date)->format('Y-m-d')) }}">
                    @error($prefix.'_'.$n.'_birth_date')
                    <span class="text-sm text-danger">
                        {!! strip_tags($reservation->guest->getTranslation(App\Helpers\TranslationKeysEnum::REQUIRED)) !!}
                    </span>
                    @enderror
                </div>
            </div>
        </div>
    </div>

</div>
