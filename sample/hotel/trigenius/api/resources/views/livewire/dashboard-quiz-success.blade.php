<div class="w-100">
    <div class="btn-light btn-menu w-100 position-relative" style="background-color: {{ $style->primary }}">
        <h5 class="text-center w-100" style="color: {{ $style->text_on_color }}">Respondidos</h5>
        <span class="text-center w-100" style="color: {{ $style->warning }}">
            <span class="h1">{{ $value }}</span>
            <span>({{ $percentage }}%)</span>
        </span>
            <div style="position: absolute; top:10px; right: 0;">
                <a href="{{ route('dashboard.quiz-success') }}">
                    <i class="fa-brands fa-searchengin" style="font-size: 1.5rem; color: {{ $style->text_on_color }}"></i>
                </a>
            </div>
    </div>
</div>
