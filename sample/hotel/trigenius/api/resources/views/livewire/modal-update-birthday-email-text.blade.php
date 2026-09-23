<div class="p-3">
    <h5 class="text-primary">Texto Aniversário [email]</h5>
    <hr>
    <div wire:ignore>
        <textarea wire:model.defer="text" class="h-48 min-h-fit " name="email_subject" id="email_subject">
            {{ $text }}
        </textarea>
    </div>

    <div class="mt-3 d-flex justify-content-end">
        <div class="w-100 d-flex justify-content-start">
            <strong>Variaveis:</strong> <span class="ml-3 text-success">$guest</span> -> nome do hóspede
        </div>
        <button type="button" class="mr-3 btn btn-secondary" wire:click='close'>
            <i class="fa-solid fa-xmark"></i>
        </button>
        <button type="button" class="btn btn-success" wire:click='save'>
            <i class="fa-solid fa-floppy-disk"></i>
        </button>
    </div>

    <script>
        class MyUploadAdapter {
            constructor(loader) {
                this.loader = loader;
            }

            upload() {
                return this.loader.file
                    .then(file => new Promise((resolve, reject) => {
                        this._initRequest();
                        this._initListeners(resolve, reject, file);
                        this._sendRequest(file);
                    }));
            }

            abort() {
                if (this.xhr) {
                    this.xhr.abort();
                }
            }

            _initRequest() {
                const xhr = this.xhr = new XMLHttpRequest();

                xhr.open('POST', "{{ route('editor-upload') }}", true);
                xhr.setRequestHeader('X-CSRF-TOKEN', '{{ csrf_token() }}');
                xhr.responseType = 'json';
            }

            _initListeners(resolve, reject, file) {
                const xhr = this.xhr;
                const loader = this.loader;
                const genericErrorText = `Couldn't upload file: ${file.name}.`;

                xhr.addEventListener('error', () => reject(genericErrorText));
                xhr.addEventListener('abort', () => reject());
                xhr.addEventListener('load', () => {
                    const response = xhr.response;

                    if (!response || response.error) {
                        return reject(response && response.error ? response.error.message : genericErrorText);
                    }

                    resolve(response);
                });

                if (xhr.upload) {
                    xhr.upload.addEventListener('progress', evt => {
                        if (evt.lengthComputable) {
                            loader.uploadTotal = evt.total;
                            loader.uploaded = evt.loaded;
                        }
                    });
                }
            }

            _sendRequest(file) {
                const data = new FormData();

                data.append('upload', file);
                this.xhr.send(data);
            }
        }

        function MyCustomUploadAdapterPlugin(editor) {
            editor.plugins.get('FileRepository').createUploadAdapter = (loader) => {
                return new MyUploadAdapter(loader);
            };
        }

        ClassicEditor
                .create(document.querySelector('#email_subject'), {
                    extraPlugins: [MyCustomUploadAdapterPlugin],
                    // toolbar: [ 'bold', 'italic', 'alignment' ],
                })
                .then(editor => {
                    editor.model.document.on('change:data', () => {
                    @this.set('text', editor.getData());
                    })
                })
                .catch(error => {
                    console.error(error);
                });

                var p =  ClassicEditor.builtinPlugins.map( plugin => plugin.pluginName );

                console.log(p);

    </script>

</div>
