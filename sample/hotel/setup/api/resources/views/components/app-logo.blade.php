@if($logo)
<div class="h-100 d-flex justify-content-center">
    <img class="center-logo" src="{{ asset('storage/uploads/' . $logo->value) }}">
</div>
@endif
