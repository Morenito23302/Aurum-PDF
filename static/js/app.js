document.addEventListener('DOMContentLoaded', () => {

    // ══════════════════════════════════════════
    // 1. Tema
    // ══════════════════════════════════════════
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel  = document.getElementById('theme-label');
    const htmlEl      = document.documentElement;

    themeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            htmlEl.setAttribute('data-theme', 'dark');
            themeLabel.textContent = 'Oscuro';
        } else {
            htmlEl.setAttribute('data-theme', 'light');
            themeLabel.textContent = 'Claro';
        }
    });

    // ══════════════════════════════════════════
    // 2. Navegación de secciones
    // ══════════════════════════════════════════
    const navBtns  = document.querySelectorAll('.nav-btn');
    const sections = document.querySelectorAll('.tool-section');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b  => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.add('active');
        });
    });

    // ══════════════════════════════════════════
    // 3. Modal de carga
    // ══════════════════════════════════════════
    const loadingModal = document.getElementById('loading-modal');
    const loadingText  = document.getElementById('loading-text');
    const showModal = (txt = 'Procesando...') => {
        loadingText.textContent = txt;
        loadingModal.classList.add('visible');
    };
    const hideModal = () => loadingModal.classList.remove('visible');

    // ══════════════════════════════════════════
    // 4. Herramientas genéricas (drop + API)
    // ══════════════════════════════════════════
    const initTool = (toolId, apiEndpoint, isMultiple = false, acceptedExtensions = ['.pdf']) => {
        const dropZone   = document.getElementById(`drop-zone-${toolId}`);
        const fileInput  = document.getElementById(`fileput-${toolId}`);
        const fileListEl = document.getElementById(`file-list-${toolId}`);
        const btnSubmit  = document.getElementById(`btn-${toolId}`);
        const nameInput  = document.getElementById(`name-${toolId}`);

        let selectedFiles = [];

        const updateUI = () => {
            fileListEl.innerHTML = '';
            if (isMultiple) {
                selectedFiles.forEach((file, index) => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span class="file-name">📄 ${file.name}</span>
                                    <button class="remove-file" data-index="${index}">✕</button>`;
                    fileListEl.appendChild(li);
                });
                fileListEl.querySelectorAll('.remove-file').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        selectedFiles.splice(+e.target.getAttribute('data-index'), 1);
                        updateUI();
                    });
                });
                if (selectedFiles.length > 0) {
                    new Sortable(fileListEl, {
                        animation: 150,
                        onEnd(evt) {
                            const item = selectedFiles[evt.oldIndex];
                            selectedFiles.splice(evt.oldIndex, 1);
                            selectedFiles.splice(evt.newIndex, 0, item);
                        },
                    });
                }
            } else {
                if (selectedFiles.length > 0) {
                    fileListEl.innerHTML = `<div style="text-align:center;font-weight:bold;color:var(--text-color);">
                        📄 Archivo seleccionado: ${selectedFiles[0].name}</div>`;
                }
            }
            btnSubmit.disabled = isMultiple ? selectedFiles.length < 2 : selectedFiles.length === 0;
        };

        const handleFiles = (files) => {
            const valid = Array.from(files).filter(f => {
                if (acceptedExtensions.includes('*')) return true;
                const ext = '.' + f.name.split('.').pop().toLowerCase();
                return acceptedExtensions.includes(ext) || (f.type === 'application/pdf' && acceptedExtensions.includes('.pdf'));
            });
            if (!valid.length) return alert('Archivos no soportados o inválidos para esta herramienta.');
            selectedFiles = isMultiple ? [...selectedFiles, ...valid] : [valid[0]];
            updateUI();
        };

        ['dragenter','dragover','dragleave','drop'].forEach(ev => {
            dropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
        });
        ['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.add('dragover')));
        ['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove('dragover')));
        dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => handleFiles(e.target.files));

        btnSubmit.addEventListener('click', async () => {
            showModal();
            const fd = new FormData();
            if (isMultiple) selectedFiles.forEach(f => fd.append('files', f));
            else fd.append('file', selectedFiles[0]);
            if (nameInput.value.trim()) fd.append('custom_name', nameInput.value.trim());
            try {
                const res = await fetch(apiEndpoint, { method: 'POST', body: fd });
                if (!res.ok) throw new Error(await res.text());
                const disposition = res.headers.get('Content-Disposition') || '';
                let filename = 'descarga';
                const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
                if (m && m[1]) filename = m[1].replace(/['"]/g, '');
                const url = URL.createObjectURL(await res.blob());
                const a = Object.assign(document.createElement('a'), { href: url, download: filename });
                document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
                selectedFiles = []; updateUI(); nameInput.value = '';
            } catch (err) {
                alert('Error al procesar: ' + err.message);
            } finally { hideModal(); }
        });
    };

    initTool('merge',    '/api/merge/',          true);
    initTool('word',     '/api/to-word/',         false);
    initTool('tables',   '/api/extract-tables/',  false);
    initTool('images',   '/api/extract-images/',  false);
    initTool('anytopdf', '/api/any-to-pdf/',      false,
        ['.docx','.doc','.xlsx','.xls','.ppt','.pptx','.jpg','.jpeg','.png','.bmp','.tiff']);

    // ══════════════════════════════════════════════════════════════
    // 5. EDITOR PDF
    // ══════════════════════════════════════════════════════════════

    /* --- Estado global del editor --- */
    const editor = {
        pdfFile    : null,     // File original
        pdfJsDoc   : null,     // PDF.js document
        currentPage: 1,
        totalPages : 0,
        scale      : 1.0,
        pages      : [],       // [{page, width, height, blocks:[...]}]
        changes    : {},       // {blockId: {text, color_hex, size}}
        selectedId : null,
    };

    /* --- Referencias DOM del editor --- */
    const eDropZone      = document.getElementById('drop-zone-editpdf');
    const eFileInput     = document.getElementById('fileput-editpdf');
    const eFileList      = document.getElementById('file-list-editpdf');
    const eWorkspace     = document.getElementById('editor-workspace');
    const ePdfCanvas     = document.getElementById('pdf-canvas');
    const ePdfOverlays   = document.getElementById('pdf-overlays');
    const ePageIndicator = document.getElementById('page-indicator');
    const eBlocksInfo    = document.getElementById('editor-blocks-info');
    const eBtnPrev       = document.getElementById('btn-prev-page');
    const eBtnNext       = document.getElementById('btn-next-page');
    const eBtnClose      = document.getElementById('btn-close-editor');
    const eNameInput     = document.getElementById('name-editpdf');
    const eBtnExport     = document.getElementById('btn-export-edited');

    /* props panel */
    const ePropsEmpty    = document.getElementById('props-empty-state');
    const ePropsForm     = document.getElementById('props-editor-form');
    const eBlockLabel    = document.getElementById('props-block-label');
    const ePropText      = document.getElementById('prop-text');
    const ePropColor     = document.getElementById('prop-color');
    const ePropColorHex  = document.getElementById('prop-color-hex');
    const ePropSize      = document.getElementById('prop-size');
    const ePropFont      = document.getElementById('prop-font-display');
    const eBtnApply      = document.getElementById('btn-apply-block');
    const eBtnReset      = document.getElementById('btn-reset-block');
    const eChangesSum    = document.getElementById('changes-summary');
    const eChangesCount  = document.getElementById('changes-count-text');

    /* ── Drag-drop zona editor ── */
    ['dragenter','dragover','dragleave','drop'].forEach(ev => {
        eDropZone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter','dragover'].forEach(ev => eDropZone.addEventListener(ev, () => eDropZone.classList.add('dragover')));
    ['dragleave','drop'].forEach(ev => eDropZone.addEventListener(ev, () => eDropZone.classList.remove('dragover')));
    eDropZone.addEventListener('drop',  e  => handleEditorFile(e.dataTransfer.files[0]));
    eDropZone.addEventListener('click', () => eFileInput.click());
    eFileInput.addEventListener('change', e => handleEditorFile(e.target.files[0]));

    function handleEditorFile(file) {
        if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
            return alert('Por favor selecciona un archivo PDF válido.');
        }
        editor.pdfFile = file;
        eFileList.innerHTML = `<div style="text-align:center;font-weight:bold;color:var(--text-color);margin-top:10px;">
            📄 ${file.name}</div>`;
        loadPdfForEditing(file);
    }

    /* ── Carga el PDF: extrae bloques + inicia PDF.js ── */
    async function loadPdfForEditing(file) {
        showModal('Analizando documento...');
        try {
            // 1. Extraer bloques de texto del backend
            const fd = new FormData();
            fd.append('file', file);
            const res = await fetch('/api/edit-pdf/extract-text/', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            editor.pages = data.pages || [];

            const totalBlocks = editor.pages.reduce((a, p) => a + p.blocks.length, 0);

            if (totalBlocks === 0) {
                hideModal();
                return alert(
                    '⚠️ No se encontraron bloques de texto en este PDF.\n\n' +
                    'Es probable que sea un PDF escaneado (solo imágenes). ' +
                    'Usa la función "PDF a Word (OCR)" para extraer el texto primero.'
                );
            }

            // 2. Cargar en PDF.js
            const arrayBuffer = await file.arrayBuffer();
            editor.pdfJsDoc   = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            editor.totalPages = editor.pdfJsDoc.numPages;
            editor.currentPage = 1;
            editor.changes = {};
            editor.selectedId = null;

            // Mostrar workspace
            eDropZone.style.display   = 'none';
            eFileList.style.display   = 'none';
            eWorkspace.style.display  = 'block';
            eBlocksInfo.textContent   = `${totalBlocks} bloques de texto detectados`;

            updateChangesUI();
            await renderPage(editor.currentPage);

        } catch (err) {
            alert('Error al cargar el PDF: ' + err.message);
        } finally {
            hideModal();
        }
    }

    /* ── Renderiza una página con PDF.js + overlays ── */
    async function renderPage(pageNum) {
        const page       = await editor.pdfJsDoc.getPage(pageNum);
        const container  = document.getElementById('pdf-viewer-scroll');
        const maxWidth   = container.clientWidth - 24;  // padding

        // Calcular escala para ajustar al ancho
        const vp1        = page.getViewport({ scale: 1 });
        editor.scale     = Math.min(maxWidth / vp1.width, 2.0);
        const viewport   = page.getViewport({ scale: editor.scale });

        ePdfCanvas.width  = viewport.width;
        ePdfCanvas.height = viewport.height;

        // Sincronizar wrapper
        const wrapper = document.getElementById('pdf-canvas-wrapper');
        wrapper.style.width  = viewport.width  + 'px';
        wrapper.style.height = viewport.height + 'px';
        ePdfOverlays.style.width  = viewport.width  + 'px';
        ePdfOverlays.style.height = viewport.height + 'px';

        // Renderizar
        const ctx = ePdfCanvas.getContext('2d');
        ctx.clearRect(0, 0, ePdfCanvas.width, ePdfCanvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        ePageIndicator.textContent = `Página ${pageNum} de ${editor.totalPages}`;
        eBtnPrev.disabled = pageNum <= 1;
        eBtnNext.disabled = pageNum >= editor.totalPages;

        drawOverlays(pageNum - 1);   // pages array es 0-indexed
        hidePropsPanel();
    }

    /* ── Dibuja overlays interactivos sobre los bloques de texto ── */
    function drawOverlays(pageIdx) {
        ePdfOverlays.innerHTML = '';
        const pageData = editor.pages[pageIdx];
        if (!pageData) return;

        const s = editor.scale;

        pageData.blocks.forEach(block => {
            const div = document.createElement('div');
            div.className   = 'text-overlay';
            div.dataset.id  = block.id;
            div.style.left   = (block.x0 * s) + 'px';
            div.style.top    = (block.y0 * s) + 'px';
            div.style.width  = ((block.x1 - block.x0) * s) + 'px';
            div.style.height = ((block.y1 - block.y0) * s) + 'px';

            if (editor.changes[block.id]) div.classList.add('modified');
            if (editor.selectedId === block.id) div.classList.add('selected');

            div.addEventListener('click', () => selectBlock(block, pageIdx));
            ePdfOverlays.appendChild(div);
        });
    }

    /* ── Selecciona un bloque y muestra el panel de propiedades ── */
    function selectBlock(block, pageIdx) {
        // Deseleccionar previo
        document.querySelectorAll('.text-overlay.selected').forEach(el => el.classList.remove('selected'));

        editor.selectedId = block.id;
        const el = ePdfOverlays.querySelector(`[data-id="${block.id}"]`);
        if (el) el.classList.add('selected');

        // Valores actuales (de changes si fue editado, si no, originales)
        const ch = editor.changes[block.id];
        const currentText  = ch ? ch.text      : block.text;
        const currentColor = ch ? ch.color_hex : block.color_hex;
        const currentSize  = ch ? ch.size       : block.size;

        eBlockLabel.textContent = `Bloque · Pág. ${pageIdx + 1}`;
        ePropText.value         = currentText;
        ePropColor.value        = currentColor;
        ePropColorHex.textContent = currentColor;
        ePropSize.value         = currentSize;
        ePropFont.textContent   = block.font;

        // Guardar datos del bloque en el formulario para referencia
        ePropsForm.dataset.blockId  = block.id;
        ePropsForm.dataset.origText = block.text;
        ePropsForm.dataset.origColor= block.color_hex;
        ePropsForm.dataset.origSize = block.size;
        ePropsForm.dataset.pageIdx  = pageIdx;

        ePropsEmpty.style.display = 'none';
        ePropsForm.style.display  = 'block';
    }

    function hidePropsPanel() {
        ePropsEmpty.style.display = 'block';
        ePropsForm.style.display  = 'none';
        editor.selectedId = null;
    }

    /* Color picker sincroniza hex label */
    ePropColor.addEventListener('input', () => {
        ePropColorHex.textContent = ePropColor.value;
    });

    /* Aplicar cambios al bloque seleccionado */
    eBtnApply.addEventListener('click', () => {
        const blockId = ePropsForm.dataset.blockId;
        if (!blockId) return;
        const newText  = ePropText.value;
        const newColor = ePropColor.value;
        const newSize  = parseFloat(ePropSize.value) || parseFloat(ePropsForm.dataset.origSize);

        const origText  = ePropsForm.dataset.origText;
        const origColor = ePropsForm.dataset.origColor;
        const origSize  = parseFloat(ePropsForm.dataset.origSize);

        // Solo guardar si algo cambió
        if (newText !== origText || newColor !== origColor || newSize !== origSize) {
            editor.changes[blockId] = { text: newText, color_hex: newColor, size: newSize };
        } else {
            delete editor.changes[blockId];
        }

        updateChangesUI();
        drawOverlays(parseInt(ePropsForm.dataset.pageIdx));

        // Re-seleccionar visualmente
        const el = ePdfOverlays.querySelector(`[data-id="${blockId}"]`);
        if (el) el.classList.add('selected');
    });

    /* Restaurar bloque a original */
    eBtnReset.addEventListener('click', () => {
        const blockId = ePropsForm.dataset.blockId;
        if (!blockId) return;
        delete editor.changes[blockId];
        ePropText.value           = ePropsForm.dataset.origText;
        ePropColor.value          = ePropsForm.dataset.origColor;
        ePropColorHex.textContent = ePropsForm.dataset.origColor;
        ePropSize.value           = ePropsForm.dataset.origSize;
        updateChangesUI();
        drawOverlays(parseInt(ePropsForm.dataset.pageIdx));
        const el = ePdfOverlays.querySelector(`[data-id="${blockId}"]`);
        if (el) el.classList.add('selected');
    });

    /* ── Actualizar resumen de cambios ── */
    function updateChangesUI() {
        const n = Object.keys(editor.changes).length;
        eBtnExport.disabled = n === 0;
        if (n > 0) {
            eChangesSum.style.display   = 'block';
            eChangesCount.textContent   = `${n} bloque${n > 1 ? 's' : ''} modificado${n > 1 ? 's' : ''}`;
        } else {
            eChangesSum.style.display   = 'none';
        }
    }

    /* ── Navegación de páginas ── */
    eBtnPrev.addEventListener('click', async () => {
        if (editor.currentPage > 1) {
            editor.currentPage--;
            await renderPage(editor.currentPage);
        }
    });
    eBtnNext.addEventListener('click', async () => {
        if (editor.currentPage < editor.totalPages) {
            editor.currentPage++;
            await renderPage(editor.currentPage);
        }
    });

    /* ── Cerrar editor ── */
    eBtnClose.addEventListener('click', () => {
        if (Object.keys(editor.changes).length > 0) {
            if (!confirm('¿Cerrar el editor? Se perderán los cambios no exportados.')) return;
        }
        resetEditor();
    });

    function resetEditor() {
        editor.pdfFile     = null;
        editor.pdfJsDoc    = null;
        editor.pages       = [];
        editor.changes     = {};
        editor.selectedId  = null;
        eWorkspace.style.display  = 'none';
        eDropZone.style.display   = '';
        eFileList.style.display   = '';
        eFileList.innerHTML       = '';
        eFileInput.value          = '';
        eNameInput.value          = '';
        ePdfOverlays.innerHTML    = '';
        hidePropsPanel();
        updateChangesUI();
    }

    /* ── Exportar PDF editado ── */
    eBtnExport.addEventListener('click', async () => {
        if (!editor.pdfFile) return alert('No hay PDF cargado.');
        const changedIds = Object.keys(editor.changes);
        if (!changedIds.length) return alert('No hay cambios para exportar.');

        // Construir lista de ediciones para el backend
        const edits = [];
        editor.pages.forEach(pageData => {
            pageData.blocks.forEach(block => {
                if (editor.changes[block.id]) {
                    const ch = editor.changes[block.id];
                    edits.push({
                        page     : pageData.page,
                        x0       : block.x0,
                        y0       : block.y0,
                        x1       : block.x1,
                        y1       : block.y1,
                        font     : block.font,
                        flags    : block.flags,
                        size     : ch.size,
                        color_hex: ch.color_hex,
                        new_text : ch.text,
                    });
                }
            });
        });

        const customName = eNameInput.value.trim() ||
            editor.pdfFile.name.replace(/\.pdf$/i, '') + '_editado';

        showModal('Aplicando cambios y generando PDF...');
        try {
            const fd = new FormData();
            fd.append('file', editor.pdfFile);
            fd.append('edits', JSON.stringify(edits));
            fd.append('custom_name', customName);

            const res = await fetch('/api/edit-pdf/export/', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(await res.text());

            const disposition = res.headers.get('Content-Disposition') || '';
            let filename = customName + '.pdf';
            const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (m && m[1]) filename = m[1].replace(/['"]/g, '');

            const url = URL.createObjectURL(await res.blob());
            const a = Object.assign(document.createElement('a'), { href: url, download: filename });
            document.body.appendChild(a); a.click(); a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Error al exportar: ' + err.message);
        } finally {
            hideModal();
        }
    });

    // Inicializar botón exportar deshabilitado
    eBtnExport.disabled = true;

});
