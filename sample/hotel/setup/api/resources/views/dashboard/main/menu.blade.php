<x-app-layout>
    <x-slot name="header">
        <x-dashboard-header title="Dashboard" />
    </x-slot>

    <div class="py-12">
        <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                <div class="p-6 bg-white border-b border-gray-200">

                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="mr-3 fa-solid fa-calendar-days"></i>
                                Reservas
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-2 col-md-3 col-sm-6">
                                <livewire:dashboard-reservation-total />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-reservation-invalid-email />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-reservation-no-email />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-reservation-countries />
                            </div>
                        </div>
                    </div>


                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="fa-solid fa-user-check"></i>
                                Checkin
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                {{-- @livewire('dashboard-checkin-sent') --}}
                                <livewire:dashboard-checkin-sent />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                {{-- @livewire('dashboard-checkin-success') --}}
                                <livewire:dashboard-checkin-success />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                        </div>
                    </div>

                    <div>
                        <div class="mt-3 mb-3">
                            <span class="h4">
                                <i class="fa-solid fa-person-circle-question"></i>
                                Questionários
                            </span>
                            <hr>
                        </div>

                        <div class="row">
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-quiz-sent />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-quiz-success />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">
                                <livewire:dashboard-quiz-responses />
                            </div>
                            <div class="mb-2 col-md-3 col-sm-6 d-flex justify-content-center">

                            </div>
                        </div>
                    </div>



                </div>
            </div>
        </div>
    </div>
</x-app-layout>
