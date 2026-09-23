<x-app-layout>
    <x-slot name="header">
        <x-dashboard-header title="Hóspedes" />
    </x-slot>

    <div class="py-12">
        <div class="mx-auto max-w-7xl sm:px-6 lg:px-8">
            <div class="overflow-hidden bg-white shadow-sm sm:rounded-lg">
                <div class="p-6 bg-white border-b border-gray-200">

                    @livewire('frm-config-translation-guests')

                </div>
            </div>
        </div>
    </div>
</x-app-layout>
