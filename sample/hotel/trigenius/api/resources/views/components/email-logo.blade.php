@if($logo)
<div style="text-align: center;">
    <img height="150px" src="{{ $message->embed(storage_path('app/public/uploads/' . $logo->value)) }}">
</div>
@endif
