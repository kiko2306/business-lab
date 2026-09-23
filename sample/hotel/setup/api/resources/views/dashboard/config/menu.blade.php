<x-app-layout>
    <x-slot name="header">
        <x-dashboard-header title="Configurações" />
    </x-slot>

    <div class="py-12">
        <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                <div class="p-6 bg-white border-b border-gray-200">

                    {{-- Wintouch --}}
                    <div>
                        <div class="mb-3">
                            <img src="{{ asset('storage/img/wintouch.png') }}">
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.db_connection') }}">
                                    <i class="fa-solid fa-database"></i>
                                    Ligação BD
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.units') }}">
                                    <i class="fa-solid fa-hotel"></i>
                                    Unidades
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                        </div>
                    </div>

                    {{-- Config Local --}}
                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="fa-solid fa-gear"></i>
                                Configurações locais
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.logo') }}">
                                    <i class="fa-solid fa-image"></i>
                                    Logotipo
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.personal-page') }}">
                                    <i class="fa-solid fa-globe"></i>
                                    Pagina pessoal
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.users') }}">
                                    <i class="fa-solid fa-users"></i>
                                    Utilizadores
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                        </div>
                    </div>

                    {{-- Events --}}
                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="fa-solid fa-calendar-days"></i>
                                Eventos
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.events') }}">
                                    <i class="fa-regular fa-calendar"></i>
                                    Eventos
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.texts') }}">
                                    <i class="fa-solid fa-file-lines"></i>
                                    Textos
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.quiz') }}">
                                    <i class="fa-solid fa-person-circle-question"></i>
                                    Questionarios
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.quiz-groups') }}">
                                    <i class="fa-solid fa-layer-group"></i>
                                    Grupos dos Questionarios
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.quiz-questions') }}">
                                    <i class="fa-solid fa-clipboard-question"></i>
                                    Perguntas dos Questionários
                                </x-button.dashboard-config>
                            </div>
                        </div>
                    </div>


                    {{-- Teste --}}
                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="fa-solid fa-check"></i>
                                Testes
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.test-checkin') }}">
                                    <i class="fa-solid fa-user-check"></i>
                                    Checkin
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">
                                <x-button.dashboard-config href="{{ route('configuration.test-quiz') }}">
                                    <i class="fa-solid fa-person-circle-question"></i>
                                    Questionário
                                </x-button.dashboard-config>
                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                            <div class="mb-3 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    </div>
</x-app-layout>
