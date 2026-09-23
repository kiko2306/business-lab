<div class="p-3">
    <h5 class="text-primary">Aniversário Assunto</h5>
    <hr>
    <div wire:ignore>
        <textarea wire:model.defer="text" class="h-48 min-h-fit " name="email_subject" id="email_subject">
            {{ $text }}
        </textarea>
    </div>

    <div class="mt-3 d-flex justify-content-end">
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

    <script>
        ClassicEditor
                .create(document.querySelector('#email_subject'), {
                    toolbar: ['undo', 'redo' ]
                })
                .then(editor => {
                    editor.model.document.on('change:data', () => {
                    @this.set('text', editor.getData());
                    })
                })
                .catch(error => {
                    console.error(error);
                });
    </script>
</div>

