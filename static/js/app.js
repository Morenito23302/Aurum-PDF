document.addEventListener('DOMContentLoaded', () => {

    /* ─── Tema ─── */
    const themeToggle = document.getElementById('theme-toggle');
    const themeLabel  = document.getElementById('theme-label');
    themeToggle.addEventListener('change', e => {
        document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
        themeLabel.textContent = e.target.checked ? 'Oscuro' : 'Claro';
    });

    /* ─── Navegación de secciones ─── */
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tool-section').forEach(s => s.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });

    /* ─── Modal ─── */
    const loadingModal = document.getElementById('loading-modal');
    const loadingText  = document.getElementById('loading-text');
    const showModal = (t = 'Procesando...') => { loadingText.textContent = t; loadingModal.classList.add('visible'); };
    const hideModal = () => loadingModal.classList.remove('visible');

    /* ─── Herramientas genéricas ─── */
    const initTool = (id, url, multi = false, exts = ['.pdf']) => {
        const dz   = document.getElementById(`drop-zone-${id}`);
        const fi   = document.getElementById(`fileput-${id}`);
        const fl   = document.getElementById(`file-list-${id}`);
        const btn  = document.getElementById(`btn-${id}`);
        const name = document.getElementById(`name-${id}`);
        let files  = [];

        const ui = () => {
            fl.innerHTML = '';
            if (multi) {
                files.forEach((f, i) => {
                    const li = document.createElement('li');
                    li.innerHTML = `<span class="file-name">📄 ${f.name}</span><button class="remove-file" data-index="${i}">✕</button>`;
                    fl.appendChild(li);
                });
                fl.querySelectorAll('.remove-file').forEach(b => b.addEventListener('click', e => { files.splice(+e.target.dataset.index, 1); ui(); }));
                if (files.length) new Sortable(fl, { animation: 150, onEnd(e) { const x = files[e.oldIndex]; files.splice(e.oldIndex, 1); files.splice(e.newIndex, 0, x); } });
            } else if (files.length) {
                fl.innerHTML = `<div style="text-align:center;font-weight:bold;color:var(--text-color)">📄 ${files[0].name}</div>`;
            }
            btn.disabled = multi ? files.length < 2 : !files.length;
        };

        const add = fs => {
            const ok = Array.from(fs).filter(f => exts.includes('*') || exts.includes('.' + f.name.split('.').pop().toLowerCase()) || (f.type === 'application/pdf' && exts.includes('.pdf')));
            if (!ok.length) return alert('Archivos no soportados.');
            files = multi ? [...files, ...ok] : [ok[0]];
            ui();
        };

        ['dragenter','dragover','dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
        ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, () => dz.classList.add('dragover')));
        ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, () => dz.classList.remove('dragover')));
        dz.addEventListener('drop', e => add(e.dataTransfer.files));
        dz.addEventListener('click', () => fi.click());
        fi.addEventListener('change', e => add(e.target.files));

        btn.addEventListener('click', async () => {
            const statusMsgs = {
                'word': 'Analizando y convirtiendo... esto puede tardar un poco si hay OCR.',
                'anytopdf': 'Convirtiendo y uniendo documentos...',
                'merge': 'Uniendo PDFs...',
                'excel': 'Extrayendo a Excel...',
                'unlock': 'Desbloqueando documento...',
                'images': 'Extrayendo imágenes...'
            };
            showModal(statusMsgs[id] || 'Procesando...');
            
            const fd = new FormData();
            if (multi) files.forEach(f => fd.append('files', f)); else fd.append('file', files[0]);
            if (name.value.trim()) fd.append('custom_name', name.value.trim());
            
            // Parámetros específicos por herramienta
            if (id === 'word') {
                const modeVal = document.getElementById('mode-word').value;
                fd.append('mode', modeVal);
            }
            if (id === 'unlock') {
                const modeUnlock = document.getElementById('mode-unlock').value;
                const passVal = document.getElementById('pass-unlock').value;
                fd.append('mode', modeUnlock);
                fd.append('password', passVal);
            }

            try {
                const res = await fetch(url, { method: 'POST', body: fd });
                if (!res.ok) {
                    let errText = await res.text();
                    
                    // Si el cuerpo está vacío, usar el status text
                    if (!errText.trim()) errText = res.statusText || 'Error desconocido en el servidor.';

                    // Si recibimos HTML (error 500 de Django/Render), limpiar el mensaje
                    if (errText.includes('<!DOCTYPE html>') || errText.includes('<html>')) {
                        throw new Error('Error crítico en el servidor (500). El archivo podría ser demasiado pesado para la memoria del servidor o hubo un tiempo de espera agotado.');
                    }
                    // Si es JSON con campo error, usarlo
                    try {
                        const jsonErr = JSON.parse(errText);
                        if (jsonErr.error) errText = jsonErr.error;
                    } catch(e) {}
                    throw new Error(errText);
                }
                const disp = res.headers.get('Content-Disposition') || '';
                let filename = 'descarga';
                const utf8Match = /filename\*=utf-8''([^;]+)/i.exec(disp);
                if (utf8Match) {
                    filename = decodeURIComponent(utf8Match[1]);
                } else {
                    const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disp);
                    if (m) filename = m[1].replace(/['"]/g, '');
                }

                const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: filename });
                document.body.appendChild(a); a.click(); a.remove();
                files = []; ui(); name.value = '';
            } catch (e) { 
                console.error(e);
                alert('⚠️ AURUM PDF informa:\n' + e.message); 
            } finally { hideModal(); }
        });
    };

    initTool('merge',    '/api/merge/',          true);
    initTool('word',     '/api/to-word/',         false);
    initTool('excel',    '/api/to-excel/',        false);
    initTool('images',   '/api/extract-images/',  false);
    initTool('anytopdf', '/api/any-to-pdf/',      true, ['.docx','.doc','.xlsx','.xls','.ppt','.pptx','.jpg','.jpeg','.png','.bmp','.tiff','.pdf']);
    initTool('unlock',   '/api/unlock/',          false);

    /* ════════════════════════════════════════════════
       EDITOR PDF
    ════════════════════════════════════════════════ */
    const E = {
        file: null, pdfDoc: null, currentPage: 1, totalPages: 0,
        autoScale: 1.0, zoomLevel: 1.0,
        get scale() { return this.autoScale * this.zoomLevel; },
        pages: [], changes: {}, selectedId: null,
        snapshot: null,   // ImageData of the clean rendered page
        history: [],      // Historial de estados (JSON strings de changes)
        search: { query: '', results: [], activeIndex: -1, matchIds: new Set() }
    };

    const $  = id => document.getElementById(id);
    const eDZ        = $('drop-zone-editpdf');
    const eFI        = $('fileput-editpdf');
    const eFL        = $('file-list-editpdf');
    const eWS        = $('editor-workspace');
    const ePdfC      = $('pdf-canvas');
    const eEditC     = $('edit-canvas');
    const eOvr       = $('pdf-overlays');
    const ePageInd   = $('page-indicator');
    const eBlockInf  = $('editor-blocks-info');
    const eBtnPrev   = $('btn-prev-page');
    const eBtnNext   = $('btn-next-page');
    const eBtnClose  = $('btn-close-editor');
    const eBtnZI     = $('btn-zoom-in');
    const eBtnZO     = $('btn-zoom-out');
    const eBtnZF     = $('btn-zoom-fit');
    const eZoomLbl   = $('zoom-label');
    const eNameIn    = $('name-editpdf');
    const eBtnExp    = $('btn-export-edited');
    const ePropsEmp  = $('props-empty-state');
    const ePropsForm = $('props-editor-form');
    const eBlkLbl    = $('props-block-label');
    const ePText     = $('prop-text');
    const ePColor    = $('prop-color');
    const ePColorHex = $('prop-color-hex');
    const ePSize     = $('prop-size');
    const ePFont     = $('prop-font-display');
    const eBtnApp    = $('btn-apply-block');
    const eBtnRst    = $('btn-reset-block');
    const eBtnUndo   = $('btn-undo');
    const eChSum     = $('changes-summary');
    const eChCnt     = $('changes-count-text');
    const eSearchIn  = $('editor-search-input');
    const eSearchCnt = $('editor-search-count');
    const eBtnSP     = $('btn-search-prev');
    const eBtnSN     = $('btn-search-next');
    const eBtnSC     = $('btn-search-clear');
    const eFRPanel   = $('find-replace-panel');
    const eReplaceRow= $('replace-panel-row');
    const eReplaceIn = $('editor-replace-input');
    const eBtnOpenF  = $('btn-open-find');
    const eBtnOpenR  = $('btn-open-replace');
    const eBtnTogR   = $('btn-toggle-replace-row');
    const eBtnRepOne = $('btn-replace-one');
    const eBtnRepAll = $('btn-replace-all');
    const eReplaceNote= $('find-panel-note');
    const eFPStatus  = $('find-panel-status');

    /* ── Font helpers (canvas) ── */
    const fontFamily = fn => {
        const n = fn.split('+').pop().toLowerCase();
        if (/times|roman|palatino|garamond|georgia|minion|caslon/.test(n)) return '"Times New Roman",Times,serif';
        if (/courier|mono|consolas|menlo|inconsolata/.test(n)) return '"Courier New",Courier,monospace';
        return 'Arial,Helvetica,sans-serif';
    };
    const fontStyle = (fn, flags) => {
        const n = fn.split('+').pop().toLowerCase();
        const b = (flags & 16) || /bold|black|heavy/.test(n);
        const i = (flags & 2)  || /italic|oblique/.test(n);
        return (i ? 'italic ' : '') + (b ? 'bold ' : '');
    };
    const currentSearchResult = () => E.search.results[E.search.activeIndex] || null;
    const matchesSearch = id => E.search.matchIds.has(id);
    const isCurrentSearch = id => Boolean(currentSearchResult()?.spanIds.includes(id));
    const getEffectiveBlockText = blk => E.changes[blk.id]?.text ?? blk.text;

    /* ── Motor de búsqueda en TODO el PDF ──
       Une los spans de cada línea (el PDF suele partir palabras y frases en
       varios fragmentos) y busca cada coincidencia en todas las páginas, como
       el Buscar/Reemplazar de Excel. */
    const eOptCase   = $('find-opt-case');
    const eOptWord   = $('find-opt-word');
    const eOptAccent = $('find-opt-accents');
    const eResList   = $('find-results-list');
    const eResSum    = $('find-results-summary');

    const searchOpts = () => ({
        matchCase: Boolean(eOptCase?.checked),
        wholeWord: Boolean(eOptWord?.checked),
        ignoreAccents: Boolean(eOptAccent?.checked)
    });

    // Normaliza carácter por carácter para que los índices sigan alineados
    // con el texto original (á -> a ocupa lo mismo).
    const foldText = (text, opts) => Array.from(text || '', ch => {
        let c = opts.matchCase ? ch : ch.toLocaleLowerCase('es');
        if (opts.ignoreAccents) {
            const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
            if (base.length === 1) c = base;
        }
        return c.length === ch.length ? c : ch;
    }).join('');

    const isWordChar = ch => Boolean(ch) && /[\p{L}\p{N}_]/u.test(ch);

    // Líneas de una página: texto unido + qué tramo aporta cada span. Entre
    // spans separados visualmente se agrega un espacio "virtual".
    const buildPageLines = pageIdx => {
        const pg = E.pages[pageIdx]; if (!pg) return [];
        const lines = [];
        const byKey = new Map();
        pg.blocks.forEach(blk => {
            const key = blk.line || `${blk.id}`;
            let line = byKey.get(key);
            if (!line) { line = { key, pageIdx, parts: [], text: '' }; byKey.set(key, line); lines.push(line); }
            const text = getEffectiveBlockText(blk);
            const prev = line.parts[line.parts.length - 1];
            if (prev && text) {
                const gap = blk.x0 - prev.blk.x1;
                if (gap > blk.size * 0.15 && !/\s$/.test(line.text) && !/^\s/.test(text)) line.text += ' ';
            }
            const start = line.text.length;
            line.text += text;
            line.parts.push({ blk, start, end: line.text.length });
        });
        return lines;
    };

    const findInLine = (line, needle, opts) => {
        const hay = foldText(line.text, opts);
        const found = [];
        let from = 0;
        while (needle && from <= hay.length) {
            const idx = hay.indexOf(needle, from);
            if (idx < 0) break;
            const end = idx + needle.length;
            if (!opts.wholeWord || (!isWordChar(line.text[idx - 1]) && !isWordChar(line.text[end]))) {
                found.push({ start: idx, end });
                from = end;
            } else {
                from = idx + 1;
            }
        }
        return found;
    };

    const collectMatches = (query, opts) => {
        const needle = foldText(query, opts);
        const results = [];
        E.pages.forEach((_, pageIdx) => {
            buildPageLines(pageIdx).forEach(line => {
                findInLine(line, needle, opts).forEach(({ start, end }) => {
                    const parts = line.parts.filter(p => p.end > start && p.start < end && p.end > p.start);
                    if (!parts.length) return;
                    results.push({
                        pageIdx, lineKey: line.key, start, end,
                        spanIds: parts.map(p => p.blk.id),
                        before: line.text.slice(Math.max(0, start - 30), start),
                        match: line.text.slice(start, end),
                        after: line.text.slice(end, end + 30)
                    });
                });
            });
        });
        return results;
    };

    // Reemplaza el tramo [start, end) de una línea repartiendo el cambio entre
    // los spans que toca: el primero recibe el reemplazo, los demás pierden
    // la parte que estaba dentro de la coincidencia.
    const replaceInLine = (line, start, end, replacement) => {
        let placed = false;
        line.parts.forEach(part => {
            if (part.end <= start || part.start >= end || part.end === part.start) return;
            const text = getEffectiveBlockText(part.blk);
            const ls = Math.max(0, start - part.start);
            const le = Math.min(text.length, end - part.start);
            const newText = text.slice(0, ls) + (placed ? '' : replacement) + text.slice(le);
            placed = true;
            const ch = E.changes[part.blk.id] || {};
            ch.text = newText;
            E.changes[part.blk.id] = ch;
        });
    };

    const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const MAX_LISTED_RESULTS = 300;

    const renderResultsList = () => {
        if (!eResList) return;
        const { query, results, activeIndex } = E.search;
        if (!query || !results.length) {
            eResList.innerHTML = '';
            eResList.style.display = 'none';
            if (eResSum) eResSum.textContent = '';
            return;
        }
        const pagesWith = new Set(results.map(r => r.pageIdx)).size;
        if (eResSum) eResSum.textContent = `${results.length} coincidencia${results.length !== 1 ? 's' : ''} en ${pagesWith} página${pagesWith !== 1 ? 's' : ''} de ${E.pages.length}`;
        eResList.style.display = '';
        eResList.innerHTML = results.slice(0, MAX_LISTED_RESULTS).map((r, i) => `
            <button type="button" class="find-result-item${i === activeIndex ? ' active' : ''}" data-index="${i}">
                <span class="find-result-page">Pág. ${r.pageIdx + 1}</span>
                <span class="find-result-text">${r.before.length >= 30 ? '…' : ''}${escapeHtml(r.before)}<mark>${escapeHtml(r.match)}</mark>${escapeHtml(r.after)}${r.after.length >= 30 ? '…' : ''}</span>
            </button>`).join('')
            + (results.length > MAX_LISTED_RESULTS ? `<p class="find-results-more">Mostrando ${MAX_LISTED_RESULTS} de ${results.length}. "Reemplazar todos" aplica a todas.</p>` : '');
        eResList.querySelector('.find-result-item.active')?.scrollIntoView({ block: 'nearest' });
    };

    const updateSearchUI = () => {
        const { query, results, activeIndex } = E.search;
        eBtnSC.disabled = false; // close btn always enabled
        const hasResults = results.length > 0;
        eBtnSP.disabled = !hasResults;
        eBtnSN.disabled = !hasResults;
        eBtnRepOne.disabled = !hasResults;
        eBtnRepAll.disabled = !hasResults;
        eSearchCnt.className = 'find-panel-count';
        renderResultsList();
        if (!query) {
            eSearchCnt.textContent = '—';
            return;
        }
        if (!hasResults) {
            eSearchCnt.textContent = '0 resultados';
            eSearchCnt.classList.add('no-results');
            return;
        }
        eSearchCnt.textContent = `${activeIndex + 1} de ${results.length}`;
        eSearchCnt.classList.add('has-results');
    };

    const syncSearchHighlights = () => {
        drawOverlays(E.currentPage - 1);
        const active = currentSearchResult();
        if (active && active.pageIdx === E.currentPage - 1) {
            const el = eOvr.querySelector(`[data-id="${active.spanIds[0]}"]`);
            el?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        }
    };

    const emptySearch = () => ({ query: '', results: [], activeIndex: -1, matchIds: new Set() });

    const resetSearch = () => {
        E.search = emptySearch();
        eSearchIn.value = '';
        updateSearchUI();
        syncSearchHighlights();
    };

    /* ── Panel flotante buscar/reemplazar ── */
    let statusTimer = null;
    const showPanelStatus = msg => {
        eFPStatus.textContent = msg;
        eFPStatus.style.display = 'block';
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { eFPStatus.style.display = 'none'; }, 3000);
    };

    const openFindPanel = (withReplace = false) => {
        eFRPanel.style.display = '';
        if (withReplace) {
            eReplaceRow.style.display = '';
            eReplaceNote.style.display = 'block';
            eBtnTogR.classList.add('active');
        }
        eSearchIn.focus();
        eSearchIn.select();
    };

    const closeFindPanel = () => {
        eFRPanel.style.display = 'none';
        resetSearch();
    };

    const goToSearchIndex = async index => {
        const total = E.search.results.length;
        if (!total) return;
        const nextIndex = ((index % total) + total) % total;
        const target = E.search.results[nextIndex];
        E.search.activeIndex = nextIndex;
        updateSearchUI();
        if (E.currentPage !== target.pageIdx + 1) {
            E.currentPage = target.pageIdx + 1;
            await renderPage(E.currentPage);
        } else {
            syncSearchHighlights();
        }
        const blk = E.pages[target.pageIdx]?.blocks.find(block => block.id === target.spanIds[0]);
        if (blk) selectBlock(blk, target.pageIdx);
    };
    const goToSearchResult = offset => goToSearchIndex(E.search.activeIndex + offset);

    // jump: navegar a la coincidencia activa (al escribir la búsqueda o tras
    // reemplazar); sin jump solo se recalculan resultados y resaltados.
    const runSearch = async (rawQuery, { jump = true } = {}) => {
        const query = (rawQuery ?? '').trim();
        const prevIndex = E.search.activeIndex;
        const queryChanged = query !== E.search.query;
        E.search.query = query;
        E.search.results = query ? collectMatches(query, searchOpts()) : [];
        E.search.matchIds = new Set(E.search.results.flatMap(r => r.spanIds));

        if (!E.search.results.length) {
            E.search.activeIndex = -1;
            updateSearchUI();
            syncSearchHighlights();
            return;
        }

        // Al cambiar la búsqueda se empieza en la primera coincidencia desde la
        // página actual; si no, se conserva la posición.
        let index = Math.min(Math.max(prevIndex, 0), E.search.results.length - 1);
        if (queryChanged || prevIndex < 0) {
            const fromHere = E.search.results.findIndex(r => r.pageIdx >= E.currentPage - 1);
            index = fromHere >= 0 ? fromHere : 0;
        }
        E.search.activeIndex = index;
        if (jump) {
            await goToSearchIndex(index);
        } else {
            updateSearchUI();
            syncSearchHighlights();
        }
    };
    const refreshSearch = () => { if (E.search.query) runSearch(E.search.query, { jump: false }); };

    /* ── Redraw edits ── */
    const redrawEdits = pageIdx => {
        if (E.snapshot) {
            ePdfC.getContext('2d').putImageData(E.snapshot, 0, 0);
        }
        const ctx = eEditC.getContext('2d');
        ctx.clearRect(0, 0, eEditC.width, eEditC.height);
        const pg = E.pages[pageIdx]; if (!pg) return;
        const s  = E.scale;

        pg.blocks.forEach(blk => {
            const ch = E.changes[blk.id]; if (!ch) return;
            const effX0 = (ch.x0 ?? blk.x0) * s;
            const dy = (ch.y0 !== undefined) ? (ch.y0 - blk.y0) : 0;
            const baseOriginY = blk.origin_y ?? blk.y1;
            // Pequeño ajuste de -0.5px para alinear perfectamente con el render de PDF.js
            const effOriginY = (baseOriginY + dy) * s - 0.5;
            const sz = (ch.size ?? blk.size) * s;

            ctx.font = `${fontStyle(blk.font, blk.flags)}${sz}px ${fontFamily(blk.font)}`;
            ctx.fillStyle = ch.color_hex ?? blk.color_hex;
            ctx.textBaseline = 'alphabetic';
            
            const lines = (ch.text ?? blk.text).split('\n');
            for (let i = 0; i < lines.length; i++) {
                // Line spacing más natural para el visor
                const lineOffset = (lines.length - 1 - i) * sz * 1.05;
                ctx.fillText(lines[i], effX0, effOriginY - lineOffset);
            }
        });
    };

    /* ── Render page with PDF.js ── */
    const renderPage = async pg => {
        const page  = await E.pdfDoc.getPage(pg);
        const cont  = $('pdf-viewer-scroll');
        const maxW  = cont.clientWidth - 28;
        E.autoScale = Math.min(maxW / page.getViewport({ scale: 1 }).width, 2.5);
        const vp    = page.getViewport({ scale: E.scale });

        ePdfC.width = eEditC.width  = vp.width;
        ePdfC.height= eEditC.height = vp.height;

        // Sync wrapper so scroll container knows full size
        const wrap = $('pdf-canvas-wrapper');
        wrap.style.width  = vp.width  + 'px';
        wrap.style.height = vp.height + 'px';
        eOvr.style.width  = vp.width  + 'px';
        eOvr.style.height = vp.height + 'px';

        const ctx2d = ePdfC.getContext('2d');
        ctx2d.clearRect(0, 0, vp.width, vp.height);
        await page.render({ canvasContext: ctx2d, viewport: vp }).promise;

        // Capture clean snapshot AFTER rendering (before any edits painted)
        E.snapshot = ctx2d.getImageData(0, 0, vp.width, vp.height);

        ePageInd.textContent = `Página ${pg} de ${E.totalPages}`;
        eZoomLbl.textContent = Math.round(E.zoomLevel * 100) + '%';
        eBtnPrev.disabled = pg <= 1;
        eBtnNext.disabled = pg >= E.totalPages;

        drawOverlays(pg - 1);
        redrawEdits(pg - 1);  // paint any existing changes
        hideProps();
    };

    /* ── Overlay divs ── */
    const drawOverlays = pageIdx => {
        eOvr.innerHTML = '';
        const pg = E.pages[pageIdx]; if (!pg) return;
        const s  = E.scale;
        pg.blocks.forEach(blk => {
            const ch = E.changes[blk.id];
            const x0 = (ch?.x0 ?? blk.x0) * s;
            const y0 = (ch?.y0 ?? blk.y0) * s;
            const w  = ((ch?.x1 ?? blk.x1) - (ch?.x0 ?? blk.x0)) * s;
            const h  = ((ch?.y1 ?? blk.y1) - (ch?.y0 ?? blk.y0)) * s;
            const div = document.createElement('div');
            div.className = 'text-overlay'
                + (ch ? ' modified' : '')
                + (matchesSearch(blk.id) ? ' search-match' : '')
                + (isCurrentSearch(blk.id) ? ' search-current' : '')
                + (E.selectedId === blk.id ? ' selected' : '');
            div.dataset.id = blk.id;
            div.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${h}px`;
            setupDrag(div, blk, pageIdx);
            eOvr.appendChild(div);
        });
    };

    /* ── Drag-to-reposition ── */
    const setupDrag = (div, blk, pageIdx) => {
        div.addEventListener('mousedown', e => {
            e.preventDefault();
            const sx = e.clientX, sy = e.clientY;
            let moved = false;
            div.classList.add('dragging');
            const ch0 = E.changes[blk.id];
            // Starting position for this drag gesture (already-dragged coords or original)
            const startX0 = ch0?.x0 ?? blk.x0, startY0 = ch0?.y0 ?? blk.y0;
            const startX1 = ch0?.x1 ?? blk.x1, startY1 = ch0?.y1 ?? blk.y1;

            const onMove = e => {
                const dx = e.clientX - sx, dy = e.clientY - sy;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
                // Move overlay visually during drag
                div.style.left = (startX0 * E.scale + dx) + 'px';
                div.style.top  = (startY0 * E.scale + dy) + 'px';
            };

            const onUp = e => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
                div.classList.remove('dragging');

                if (moved) {
                    saveHistoryState();
                    const dx = (e.clientX - sx) / E.scale;
                    const dy = (e.clientY - sy) / E.scale;
                    const ch = E.changes[blk.id] || { text: blk.text, color_hex: blk.color_hex, size: blk.size };
                    ch.x0 = startX0 + dx; ch.y0 = startY0 + dy;
                    ch.x1 = startX1 + dx; ch.y1 = startY1 + dy;
                    E.changes[blk.id] = ch;
                    updateChUI();
                    drawOverlays(pageIdx);
                    redrawEdits(pageIdx);
                } else {
                    selectBlock(blk, pageIdx);
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    };

    /* ── Properties panel ── */
    const selectBlock = (blk, pageIdx) => {
        eOvr.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
        E.selectedId = blk.id;
        eOvr.querySelector(`[data-id="${blk.id}"]`)?.classList.add('selected');
        const ch = E.changes[blk.id];
        eBlkLbl.textContent    = `Bloque · Pág. ${pageIdx + 1}`;
        ePText.value           = ch?.text      ?? blk.text;
        ePColor.value          = ch?.color_hex ?? blk.color_hex;
        ePColorHex.textContent = ePColor.value;
        ePSize.value           = ch?.size      ?? blk.size;
        ePFont.textContent     = blk.font;
        ePropsForm.dataset.id      = blk.id;
        ePropsForm.dataset.oText   = blk.text;
        ePropsForm.dataset.oColor  = blk.color_hex;
        ePropsForm.dataset.oSize   = blk.size;
        ePropsForm.dataset.pageIdx = pageIdx;
        ePropsEmp.style.display  = 'none';
        ePropsForm.style.display = 'block';
    };

    const hideProps = () => {
        ePropsEmp.style.display  = 'block';
        ePropsForm.style.display = 'none';
        E.selectedId = null;
    };

    /* ── Live preview ── */
    const livePreview = () => {
        const id = ePropsForm.dataset.id;
        if (!id || ePropsForm.style.display === 'none') return;
        const idx = +ePropsForm.dataset.pageIdx;
        const blk = E.pages[idx]?.blocks.find(b => b.id === id); if (!blk) return;
        const ch  = E.changes[id] || {};
        ch.text      = ePText.value;
        ch.color_hex = ePColor.value;
        ch.size      = parseFloat(ePSize.value) || blk.size;
        E.changes[id] = ch;
        redrawEdits(idx);
        refreshSearch();
    };

    ePColor.addEventListener('input', () => { ePColorHex.textContent = ePColor.value; livePreview(); });
    ePText.addEventListener('input',  livePreview);
    ePSize.addEventListener('input',  livePreview);

    /* Apply */
    eBtnApp.addEventListener('click', () => {
        const id  = ePropsForm.dataset.id; if (!id) return;
        const idx = +ePropsForm.dataset.pageIdx;
        const blk = E.pages[idx].blocks.find(b => b.id === id);
        const t   = ePText.value, c = ePColor.value, s = parseFloat(ePSize.value) || blk.size;
        const ch  = E.changes[id] || {};
        const hasPosChange = ch.x0 !== undefined;
        
        saveHistoryState();
        if (t !== blk.text || c !== blk.color_hex || s !== blk.size || hasPosChange) {
            ch.text = t; ch.color_hex = c; ch.size = s;
            E.changes[id] = ch;
        } else { 
            delete E.changes[id]; 
        }
        updateChUI(); drawOverlays(idx); redrawEdits(idx);
        eOvr.querySelector(`[data-id="${id}"]`)?.classList.add('selected');
        refreshSearch();
    });

    /* Reset */
    eBtnRst.addEventListener('click', () => {
        const id  = ePropsForm.dataset.id; if (!id) return;
        const idx = +ePropsForm.dataset.pageIdx;
        saveHistoryState();
        delete E.changes[id];
        ePText.value           = ePropsForm.dataset.oText;
        ePColor.value          = ePropsForm.dataset.oColor;
        ePColorHex.textContent = ePColor.value;
        ePSize.value           = ePropsForm.dataset.oSize;
        updateChUI(); drawOverlays(idx); redrawEdits(idx);
        eOvr.querySelector(`[data-id="${id}"]`)?.classList.add('selected');
        refreshSearch();
    });

    const updateChUI = () => {
        const n = Object.keys(E.changes).length;
        eBtnExp.disabled = n === 0;
        eBtnUndo.disabled = E.history.length === 0;
        eChSum.style.display = n ? 'block' : 'none';
        eChCnt.textContent   = `${n} bloque${n !== 1 ? 's' : ''} modificado${n !== 1 ? 's' : ''}`;
    };

    /* ── Historial (Undo) ── */
    const saveHistoryState = () => {
        E.history.push(JSON.stringify(E.changes));
        if (E.history.length > 50) E.history.shift(); // Límite de 50 pasos
        eBtnUndo.disabled = false;
    };

    const undo = () => {
        if (!E.history.length) return;
        E.changes = JSON.parse(E.history.pop());
        updateChUI();
        drawOverlays(E.currentPage - 1);
        redrawEdits(E.currentPage - 1);
        hideProps();
    };

    /* ── Reemplazar ── */
    const lineOfResult = result => buildPageLines(result.pageIdx).find(line => line.key === result.lineKey);

    // Reemplaza solo la coincidencia activa y pasa a la siguiente.
    const replaceOne = async () => {
        const result = currentSearchResult();
        if (!result || !E.search.query) return;
        const line = lineOfResult(result);
        if (!line) return;
        saveHistoryState();
        const replacement = eReplaceIn.value;
        replaceInLine(line, result.start, result.end, replacement);
        updateChUI();
        drawOverlays(E.currentPage - 1);
        redrawEdits(E.currentPage - 1);
        await runSearch(E.search.query, { jump: false });
        if (!E.search.results.length) return;
        // Siguiente coincidencia DESPUÉS del texto recién puesto (si el
        // reemplazo contiene lo buscado, no se vuelve a caer en el mismo sitio).
        const lineOrder = new Map(buildPageLines(result.pageIdx).map((l, i) => [l.key, i]));
        const replacedOrder = lineOrder.get(result.lineKey) ?? 0;
        const newEnd = result.start + replacement.length;
        const next = E.search.results.findIndex(r => r.pageIdx > result.pageIdx
            || (r.pageIdx === result.pageIdx && ((lineOrder.get(r.lineKey) ?? 0) > replacedOrder
                || (r.lineKey === result.lineKey && r.start >= newEnd))));
        await goToSearchIndex(next >= 0 ? next : 0);
    };

    // Reemplaza TODAS las coincidencias de TODAS las páginas.
    const replaceAll = async () => {
        if (!E.search.query || !E.search.results.length) return;
        const replaceWith = eReplaceIn.value;
        const total = E.search.results.length;
        const pagesTouched = new Set(E.search.results.map(r => r.pageIdx)).size;
        saveHistoryState();
        // Por línea y de atrás hacia adelante, para que reemplazar una
        // coincidencia no corra las posiciones de las anteriores.
        const byLine = new Map();
        E.search.results.forEach(r => {
            const key = `${r.pageIdx}|${r.lineKey}`;
            if (!byLine.has(key)) byLine.set(key, []);
            byLine.get(key).push(r);
        });
        const linesCache = new Map();
        byLine.forEach(results => {
            const pageIdx = results[0].pageIdx;
            if (!linesCache.has(pageIdx)) linesCache.set(pageIdx, buildPageLines(pageIdx));
            const line = linesCache.get(pageIdx).find(l => l.key === results[0].lineKey);
            if (!line) return;
            results.sort((a, b) => b.start - a.start)
                .forEach(r => replaceInLine(line, r.start, r.end, replaceWith));
        });
        updateChUI();
        drawOverlays(E.currentPage - 1);
        redrawEdits(E.currentPage - 1);
        await runSearch(E.search.query, { jump: false });
        showPanelStatus(`✔ ${total} coincidencia${total !== 1 ? 's' : ''} reemplazada${total !== 1 ? 's' : ''} en ${pagesTouched} página${pagesTouched !== 1 ? 's' : ''}`);
    };

    eBtnUndo.addEventListener('click', () => { undo(); refreshSearch(); });
    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            openFindPanel(false);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
            e.preventDefault();
            openFindPanel(true);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
            refreshSearch();
        }
    });

    eBtnOpenF.addEventListener('click', () => openFindPanel(false));
    eBtnOpenR.addEventListener('click', () => openFindPanel(true));

    eBtnTogR.addEventListener('click', () => {
        const open = eReplaceRow.style.display !== 'none';
        eReplaceRow.style.display = open ? 'none' : '';
        eReplaceNote.style.display = open ? 'none' : 'block';
        eBtnTogR.classList.toggle('active', !open);
        if (!open) eReplaceIn.focus();
    });

    eSearchIn.addEventListener('input', e => { runSearch(e.target.value); });
    eSearchIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToSearchResult(e.shiftKey ? -1 : 1);
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeFindPanel();
        }
    });
    eReplaceIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
        if (e.key === 'Escape') { e.preventDefault(); closeFindPanel(); }
    });
    eBtnSP.addEventListener('click', () => goToSearchResult(-1));
    eBtnSN.addEventListener('click', () => goToSearchResult(1));
    eBtnSC.addEventListener('click', () => closeFindPanel());
    eBtnRepOne.addEventListener('click', () => replaceOne());
    eBtnRepAll.addEventListener('click', () => replaceAll());
    [eOptCase, eOptWord, eOptAccent].forEach(opt => opt?.addEventListener('change', () => {
        E.search.activeIndex = -1;
        if (E.search.query) runSearch(E.search.query);
    }));
    eResList?.addEventListener('click', e => {
        const item = e.target.closest('.find-result-item');
        if (item) goToSearchIndex(Number(item.dataset.index));
    });

    /* ── Zoom ── */
    const ZOOM_STEP = 0.25, ZOOM_MIN = 0.25, ZOOM_MAX = 4.0;
    const applyZoom = async lvl => {
        E.zoomLevel = Math.min(Math.max(lvl, ZOOM_MIN), ZOOM_MAX);
        await renderPage(E.currentPage);
    };
    eBtnZI.addEventListener('click', () => applyZoom(E.zoomLevel + ZOOM_STEP));
    eBtnZO.addEventListener('click', () => applyZoom(E.zoomLevel - ZOOM_STEP));
    eBtnZF.addEventListener('click', () => applyZoom(1.0));

    /* ── Page navigation ── */
    eBtnPrev.addEventListener('click', async () => { if (E.currentPage > 1)              { E.currentPage--; await renderPage(E.currentPage); } });
    eBtnNext.addEventListener('click', async () => { if (E.currentPage < E.totalPages)   { E.currentPage++; await renderPage(E.currentPage); } });

    /* ── Close editor ── */
    eBtnClose.addEventListener('click', () => {
        if (Object.keys(E.changes).length && !confirm('¿Cerrar el editor? Se perderán los cambios no exportados.')) return;
        resetEditor();
    });

    const resetEditor = () => {
        Object.assign(E, {
            file: null, pdfDoc: null, pages: [], changes: {}, selectedId: null,
            zoomLevel: 1.0, snapshot: null, history: [], search: { query: '', results: [], activeIndex: -1, matchIds: new Set() }
        });
        eWS.style.display = 'none'; eDZ.style.display = ''; eFL.style.display = '';
        eFL.innerHTML = ''; eFI.value = ''; eNameIn.value = ''; eOvr.innerHTML = '';
        eSearchIn.value = '';
        eFRPanel.style.display = 'none';
        eReplaceRow.style.display = 'none';
        eReplaceNote.style.display = 'none';
        eBtnTogR.classList.remove('active');
        hideProps(); updateChUI();
        updateSearchUI();
    };

    /* ── Drop zone ── */
    ['dragenter','dragover','dragleave','drop'].forEach(ev => eDZ.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }));
    ['dragenter','dragover'].forEach(ev => eDZ.addEventListener(ev,  () => eDZ.classList.add('dragover')));
    ['dragleave','drop'].forEach(ev  => eDZ.addEventListener(ev,  () => eDZ.classList.remove('dragover')));
    eDZ.addEventListener('drop',   e  => handleEditorFile(e.dataTransfer.files[0]));
    eDZ.addEventListener('click',  () => eFI.click());
    eFI.addEventListener('change', e  => handleEditorFile(e.target.files[0]));

    const handleEditorFile = file => {
        if (!file?.name.toLowerCase().endsWith('.pdf')) return alert('Selecciona un PDF válido.');
        E.file = file;
        eFL.innerHTML = `<div style="text-align:center;font-weight:bold;color:var(--text-color);margin-top:10px;">📄 ${file.name}</div>`;
        loadPdf(file);
    };

    const loadPdf = async file => {
        showModal('Analizando documento...');
        try {
            const fd = new FormData(); fd.append('file', file);
            const res = await fetch('/api/edit-pdf/extract-text/', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(await res.text());
            E.pages = (await res.json()).pages || [];
            const total = E.pages.reduce((a, p) => a + p.blocks.length, 0);
            if (!total) {
                hideModal();
                return alert('⚠️ No se encontraron bloques de texto.\nEste PDF parece ser escaneado. Usa "PDF a Word (OCR)" primero.');
            }
            const buf    = await file.arrayBuffer();
            E.pdfDoc     = await pdfjsLib.getDocument({ data: buf }).promise;
            E.totalPages = E.pdfDoc.numPages;
            E.currentPage = 1; E.zoomLevel = 1.0; E.changes = {}; E.selectedId = null;
            E.history = [];
            E.search = emptySearch();
            eDZ.style.display = 'none'; eFL.style.display = 'none'; eWS.style.display = 'block';
            eFRPanel.style.display = '';
            eReplaceRow.style.display = '';
            eReplaceNote.style.display = 'block';
            eBtnTogR.classList.add('active');
            eBlockInf.textContent = `${total} bloques detectados`;
            updateChUI();
            updateSearchUI();
            await renderPage(1);
        } catch (e) { alert('Error al cargar: ' + e.message); } finally { hideModal(); }
    };

    /* ── Export ── */
    eBtnExp.addEventListener('click', async () => {
        if (!E.file) return;
        const edits = [];
        E.pages.forEach(pg => pg.blocks.forEach(blk => {
            const ch = E.changes[blk.id]; if (!ch) return;
            edits.push({
                page: pg.page,
                x0: ch.x0 ?? blk.x0, y0: ch.y0 ?? blk.y0,
                x1: ch.x1 ?? blk.x1, y1: ch.y1 ?? blk.y1,
                origin_y: (ch.y0 !== undefined)
                    ? (blk.origin_y ?? blk.y1) + (ch.y0 - blk.y0)  // ajuste por arrastre
                    : (blk.origin_y ?? blk.y1),
                font: blk.font, flags: blk.flags,
                size: ch.size ?? blk.size,
                color_hex: ch.color_hex ?? blk.color_hex,
                new_text: ch.text ?? blk.text
            });
        }));
        if (!edits.length) return alert('No hay cambios para exportar.');
        const cname = eNameIn.value.trim() || E.file.name.replace(/\.pdf$/i, '') + '_editado';
        showModal('Aplicando cambios...');
        try {
            const fd = new FormData();
            fd.append('file', E.file);
            fd.append('edits', JSON.stringify(edits));
            fd.append('custom_name', cname);
            const res = await fetch('/api/edit-pdf/export/', { method: 'POST', body: fd });
            if (!res.ok) throw new Error(await res.text());
            const disp = res.headers.get('Content-Disposition') || '';
            let filename = cname + '.pdf';
            const utf8Match = /filename\*=utf-8''([^;]+)/i.exec(disp);
            if (utf8Match) {
                filename = decodeURIComponent(utf8Match[1]);
            } else {
                const m = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disp);
                if (m) filename = m[1].replace(/['"]/g, '');
            }
            const a = Object.assign(document.createElement('a'), {
                href: URL.createObjectURL(await res.blob()),
                download: filename
            });
            document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { alert('Error al exportar: ' + e.message); } finally { hideModal(); }
    });

    eBtnExp.disabled = true;
});
