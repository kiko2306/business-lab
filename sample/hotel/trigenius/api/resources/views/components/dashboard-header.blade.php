<h2 class="text-xl font-semibold leading-tight m-0">
    <div class="px-3 py-3 dashboard-header">

        @switch($title)
            @case('Dashboard')
                <i class="fa-regular fa-calendar mr-2"></i>
                @break
            @case('Configurações')
                <i class="fa-solid fa-gear mr-2"></i>
                @break
            @case('Traduções')
                <i class="fa-solid fa-language mr-2"></i>
                @break
            @case('Ligação Wintouch')
                <i class="fa-solid fa-database mr-2"></i>
                @break
            @case('Unidades Hoteleiras')
                <i class="fa-solid fa-hotel mr-2"></i>
                @break
            @case('Logotipo')
                <i class="fa-solid fa-image mr-2"></i>
                @break
            @case('Página Pessoal')
                <i class="fa-solid fa-globe mr-2"></i>
                @break
            @case('Utilizadores')
                <i class="fa-solid fa-users mr-2"></i>
                @break
            @case('Eventos')
                <i class="fa-solid fa-calendar-days mr-2"></i>
                @break
            @case('Textos')
                <i class="fa-solid fa-file-lines mr-2"></i>
                @break
            @case('Questionários')
                <i class="fa-solid fa-person-circle-question mr-2"></i>
                @break
            @case('Grupos de Questionários')
                <i class="fa-solid fa-layer-group mr-2"></i>
                @break
            @case('Perguntas Questionários')
                <i class="fa-solid fa-clipboard-question mr-2"></i>
                @break
            @case('Teste Checkin')
                <i class="fa-solid fa-person-circle-question mr-2"></i>
                @break
            @case('Teste Questionário')
                <i class="fa-solid fa-person-circle-question mr-2"></i>
                @break
            @case('Países/Linguagens')
                <i class="fa-solid fa-language mr-2"></i>
                @break

            @default

        @endswitch

        {{ $title }}
    </div>
</h2>
