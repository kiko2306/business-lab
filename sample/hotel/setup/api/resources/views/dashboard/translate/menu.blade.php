<x-app-layout>
    <x-slot name="header">
        <x-dashboard-header title="Traduções" />
    </x-slot>

    <div class="py-12">
        <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                <div class="p-6 bg-white border-b border-gray-200">

                    <div class="row">

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            {{-- <a href="{{ route('translation.country-language') }}" class="btn btn-light btn-menu" style="background-color:#dc3545 !important">
                                <i class="fa-solid fa-flag"></i>
                                Paises/Linguagens
                            </a> --}}
                            <x-button.dashboard-config href="{{ route('translation.country-language') }}">
                                <i class="fa-solid fa-flag"></i>
                                Paises/Linguagens
                            </x-button.dashboard-config>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.checkin') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-person-walking-arrow-right"></i>
                                Checkin
                            </a>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.quiz') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-person-circle-question"></i>
                                Questionario
                            </a>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.birthday') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-cake-candles"></i>
                                Aniversário
                            </a>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.promo') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-rectangle-ad"></i>
                                Promoções
                            </a>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.system') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-sitemap"></i>
                                Sistema
                            </a>
                        </div>

                        <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                            <a href="{{ route('translation.guests') }}" class="btn btn-light btn-menu">
                                <i class="fa-solid fa-person"></i>
                                Hóspedes
                            </a>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    </div>
</x-app-layout>
