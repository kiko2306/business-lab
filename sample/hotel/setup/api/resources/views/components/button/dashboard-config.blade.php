<a href="{{ $href }}" class="btn btn-light btn-menu" style="background-color: {{ App\Models\Style::active()->primary }}">
   <span style="color: {{ App\Models\Style::active()->text_on_color }}">{{ $slot }}</span>
</a>
