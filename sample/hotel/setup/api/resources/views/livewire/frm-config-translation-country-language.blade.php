<div>

    <x-loading />

    <table class="table">
        <thead>
            <tr>
                <th scope="col">Pais</th>
                <th scope="col">Linguagem</th>
                <th scope="col" class="text-center">Apagar</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($countries as $key => $country)
            <tr>
                <th scope="row">@if($country->language)
                    <span class="text-success">{{ $country->name }} </span> @else {{ $country->name }} @endif
                </th>
                <td>
                    <select wire:model="countries.{{ $key }}.language_id" class="form-control">
                        <option value="">Selecione</option>
                        @foreach ($languages as $language)
                        <option value="{{ $language->id }}">{{ $language->name }}</option>
                        @endforeach
                    </select>
                </td>
                <td class="text-center">
                    <button class="btn btn-danger" wire:click='removeLanguage({{ $country }})'>
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
            @endforeach
        </tbody>
    </table>

    @if ($saved)
    <div class="my-3 alert alert-success alert-dismissible fade show" role="alert">
        <strong>Gravado</strong> com sucesso.
        <button type="button" class="btn-close" aria-label="Close" wire:click='closeAlert'></button>
    </div>
    @endif

    <div class="d-flex justify-content-end">

        <a href="{{ route('translation.menu') }}" class="mr-3 btn btn-danger btn-default-size">
            <i class="fa-solid fa-arrow-left"></i>
        </a>

        <button class="btn btn-success btn-default-size" wire:click='save'>
            <i class="fa-regular fa-floppy-disk"></i>
        </button>

    </div>
</div>
