<x-app-layout>
    <x-slot name="header">
        <h2 class="font-semibold text-xl text-gray-800 leading-tight">
            {{ __('Test') }}
        </h2>
    </x-slot>

    <div class="py-12">
        <div class="max-w-7xl mx-auto sm:px-6 lg:px-8">
            <div class="bg-white overflow-hidden shadow-xl sm:rounded-lg">

                <form action="{{ route('users.update', ['id' => $user->id]) }}" method="POST">
                    @csrf
                    @method('PUT')

                    <div class="form-group">
                        <label for="user-name">Nome</label>
                        <input type="text" id="user-name" name="name" value="{{ $user->name }}" />
                    </div>

                    <div class="form-group">
                        <label for="user-email">Email</label>
                        <input type="email" id="user-email" name="email" value="{{ $user->email }}" />
                    </div>

                    <div class="form-group">
                        <label for="user-is_admin">Admin</label>
                        <input type="checkbox" id="user-is_admin" name="is_admin" value="true" {{ $user->is_admin  ? 'checked' : '' }}>
                    </div>

                    <div class="form-group">
                        <label for="user-email_quiz_response">email_quiz_response</label>
                        <input type="checkbox" id="user-email_quiz_response" name="email_quiz_response" value="true">
                    </div>

                    <div class="form-group">
                        <label for="user-email_check_in_response">email_check_in_response</label>
                        <input type="checkbox" id="user-email_check_in_response" name="email_check_in_response">
                    </div>

                    <div class="form-group">
                        <label for="user-notify_guest_no_mail">notify_guest_no_mail</label>
                        <input type="checkbox" id="user-notify_guest_no_mail" name="notify_guest_no_mail">
                    </div>

                    <div class="form-group">
                        <label for="user-notify_guest_invalid_mail">Admin</label>
                        <input type="checkbox" id="user-notify_guest_invalid_mail" name="notify_guest_invalid_mail">
                    </div>

                    <button type="submit">send</button>

                </form>

            </div>
        </div>
    </div>
</x-app-layout>
