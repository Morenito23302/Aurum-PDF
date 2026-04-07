document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Configuration
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel = document.getElementById('theme-label');
    const htmlElement = document.documentElement;

    themeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            htmlElement.setAttribute('data-theme', 'dark');
            themeLabel.textContent = 'Oscuro';
        } else {
            htmlElement.setAttribute('data-theme', 'light');
            themeLabel.textContent = 'Claro';
        }
    });

    // 2. Navigation
    const navBtns = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.tool-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all
            navBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            // Add active to clicked
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // 3. Modal helper
    const loadingModal = document.getElementById('loading-modal');
    const showModal = () => loadingModal.classList.add('visible');
    const hideModal = () => loadingModal.classList.remove('visible');

    // 4. File Handlers and Managers
    const initTool = (toolId, apiEndpoint, isMultiple = false) => {
        const dropZone = document.getElementById(`drop-zone-${toolId}`);
        const fileInput = document.getElementById(`fileput-${toolId}`);
        const fileListContainer = document.getElementById(`file-list-${toolId}`);
        const btnSubmit = document.getElementById(`btn-${toolId}`);
        const nameInput = document.getElementById(`name-${toolId}`);

        let selectedFiles = [];

        const updateUI = () => {
            fileListContainer.innerHTML = '';
            
            if (isMultiple) {
                // If sortable, populate LIs
                selectedFiles.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.innerHTML = `
                        <span class="file-name">📄 ${file.name}</span>
                        <button class="remove-file" data-index="${index}">X</button>
                    `;
                    fileListContainer.appendChild(li);
                });

                // Attach remove events
                fileListContainer.querySelectorAll('.remove-file').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const idx = e.target.getAttribute('data-index');
                        selectedFiles.splice(idx, 1);
                        updateUI();
                    });
                });
                
                // Initialize Sortable if multiple
                if(selectedFiles.length > 0) {
                    new Sortable(fileListContainer, {
                        animation: 150,
                        onEnd: function (evt) {
                            // Update selectedFiles array based on new DOM order
                            const itemEl = selectedFiles[evt.oldIndex];
                            selectedFiles.splice(evt.oldIndex, 1);
                            selectedFiles.splice(evt.newIndex, 0, itemEl);
                        },
                    });
                }
            } else {
                if (selectedFiles.length > 0) {
                    fileListContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:var(--text-color);">📄 Archivo seleccionado: ${selectedFiles[0].name}</div>`;
                }
            }

            // Enable/Disable buttons
            if (isMultiple) {
                btnSubmit.disabled = selectedFiles.length < 2;
            } else {
                btnSubmit.disabled = selectedFiles.length === 0;
            }
        };

        const handleFiles = (files) => {
            const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf');
            if (pdfFiles.length === 0) return alert("Solo se aceptan archivos PDF.");

            if (isMultiple) {
                selectedFiles = [...selectedFiles, ...pdfFiles];
            } else {
                selectedFiles = [pdfFiles[0]];
            }
            updateUI();
        };

        // Drag events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
        });

        dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files), false);
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

        // Submit to API
        btnSubmit.addEventListener('click', async () => {
            showModal();
            const formData = new FormData();
            
            if (isMultiple) {
                selectedFiles.forEach(f => formData.append('files', f));
            } else {
                formData.append('file', selectedFiles[0]);
            }

            if (nameInput.value.trim() !== '') {
                formData.append('custom_name', nameInput.value.trim());
            }

            try {
                const response = await fetch(apiEndpoint, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error("Error en el servidor o archivo inválido.");
                }

                // Obtener el header del filename si es posible, o usar fallback
                const disposition = response.headers.get('Content-Disposition');
                let filename = 'descarga';
                if (disposition && disposition.indexOf('attachment') !== -1) {
                    var filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                    var matches = filenameRegex.exec(disposition);
                    if (matches != null && matches[1]) { 
                        filename = matches[1].replace(/['"]/g, '');
                    }
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                
                // Clear state
                selectedFiles = [];
                updateUI();
                nameInput.value = '';

            } catch (error) {
                console.error(error);
                alert("Ocurrió un error al procesar el archivo. " + error.message);
            } finally {
                hideModal();
            }
        });
    };

    // Initialize all 4 tools
    initTool('merge', '/api/merge/', true);
    initTool('word', '/api/to-word/', false);
    initTool('tables', '/api/extract-tables/', false);
    initTool('images', '/api/extract-images/', false);

});
