<x-app-layout>
    <x-slot name="header">
        <x-dashboard-header title="Reservas por País" />
    </x-slot>

    <div class="py-12">
        <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                <div class="p-6 bg-white border-b border-gray-200">

                   @livewire('dashboard-reservation-countries-details')

                    <div class="d-flex justify-content-end">

                        <a href="{{ route('dashboard') }}" class="btn btn-danger btn-default-size">
                            <i class="fa-solid fa-arrow-left"></i>
                        </a>

                    </div>

                </div>
            </div>
        </div>
    </div>
</x-app-layout>
