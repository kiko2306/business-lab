<div>

    @foreach ($color_keys as $key => $color_key)

    <div class="form-group">
        <label for="sample_color">
            {{ $color_key }}
            {{-- TODO: explanation text --}}
        </label>
        <input type="text" name="{{ $color_key }}" class="colorpicker form-control">
    </div>

    @endforeach


    <button class="btn" wire:click='save'>Save</button>

    @section('javascript')
    <script src="https://cdnjs.cloudflare.com/ajax/libs/bootstrap-colorpicker/2.5.3/js/bootstrap-colorpicker.min.js"></script>
    <script>
        $('.colorpicker').colorpicker({format: 'hex'});
    </script>
    @endsection

</div>
