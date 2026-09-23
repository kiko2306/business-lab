<div>
    <div wire:ignore>
        <textarea wire:model.defer="email_subject" class="min-h-fit h-48 " name="email_subject" id="email_subject">
            {!! $email_subject !!}
        </textarea>
    </div>

    <div wire:ignore>
        <textarea wire:model.defer="email_text" class="min-h-fit h-48 " name="email_text" id="email_text">
            {!! $email_text !!}
        </textarea>
    </div>

    <div wire:ignore>
        <textarea wire:model.defer="page_text" class="min-h-fit h-48 " name="page_text" id="page_text">
            {!! $page_text !!}
        </textarea>
    </div>

    <div>
        <button wire:click='save'>save</button>
    </div>
</div>

@push('scripts')


<script>
    function init() {
    var a,b,c = null;
        ClassicEditor
            .create(document.querySelector('#email_subject'), {
                toolbar: [ 'bold', 'italic', 'link', 'undo', 'redo', 'numberedList', 'bulletedList' ]
            })
            .then(editor => {
                a = editor;
                editor.model.document.on('change:data', () => {
                @this.set('email_subject', editor.getData());
                })
            })
            .catch(error => {
                console.error(error);
            });

    ClassicEditor
            .create(document.querySelector('#email_text'))
            .then(editor => {
                b = editor;
                editor.model.document.on('change:data', () => {
                @this.set('email_text', editor.getData());
                })
            })
            .catch(error => {
                console.error(error);
            });

    ClassicEditor
        .create(document.querySelector('#page_text'))
        .then(editor => {
            c = editor;
            editor.model.document.on('change:data', () => {
            @this.set('page_text', editor.getData());
            })
        })
        .catch(error => {
            console.error(error);
        });

        Livewire.on('selectedEventChanged', () => {
            a.destroy();
            b.destroy();
            c.destroy();
            init();
        })
    }


    init();

</script>



@endpush
