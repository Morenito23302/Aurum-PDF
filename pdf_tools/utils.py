import os
import fitz  # PyMuPDF
import tempfile
import zipfile
import pdfplumber
import pandas as pd
from io import BytesIO
from pdf2image import convert_from_path
import pytesseract
from docx import Document
import subprocess
from PIL import Image


# ═════════════════════════════════════════════════════════════════════════════
# Merge PDFs
# ═════════════════════════════════════════════════════════════════════════════

def merge_pdfs_util(file_paths, output_path):
    result_pdf = fitz.open()
    for fp in file_paths:
        with fitz.open(fp) as doc:
            result_pdf.insert_pdf(doc)
    result_pdf.save(output_path)
    result_pdf.close()


# ═════════════════════════════════════════════════════════════════════════════
# PDF → DOCX  (motor propio de alta fidelidad)
# ═════════════════════════════════════════════════════════════════════════════

_PT_TO_TWIPS = 20   # 1 punto PDF = 20 twips Word  (usado en framePr / tblpPr)


def _pt_emu(pt):
    """Puntos PDF → EMU (para Emu() de python-docx)."""
    return int(pt * 12700)


def _color_to_hex(color):
    """
    Convierte un valor de color de pdfplumber (int, float, tuple/list) a
    una cadena hexadecimal RGB de 6 dígitos, o None si no es válido.
    """
    if color is None:
        return None
    if isinstance(color, (int, float)):
        v = int(min(max(float(color), 0.0), 1.0) * 255) if float(color) <= 1.0 else int(min(color, 255))
        return f"{v:02X}{v:02X}{v:02X}"
    if isinstance(color, (list, tuple)):
        if len(color) == 1:
            v = int(min(max(float(color[0]), 0.0), 1.0) * 255)
            return f"{v:02X}{v:02X}{v:02X}"
        if len(color) >= 3:
            ch = color[:3]
            if all(float(c) <= 1.0 for c in ch):
                r, g, b = [int(float(c) * 255) for c in ch]
            else:
                r, g, b = int(color[0]), int(color[1]), int(color[2])
            return f"{r:02X}{g:02X}{b:02X}"
    return None


def _set_cell_bgcolor(cell, fill_hex, qn):
    """Aplica color de fondo a una celda de tabla DOCX."""
    from docx.oxml import OxmlElement
    tc   = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for old in tcPr.findall(qn('w:shd')):
        tcPr.remove(old)
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'),   'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'),  fill_hex.upper())
    tcPr.append(shd)


def _float_table(tbl, x_pt, y_pt, qn):
    """
    Posiciona la tabla de forma absoluta en la página usando w:tblpPr.
    Esto hace que la tabla «flote» sin empujar el flujo de texto.
    """
    from docx.oxml import OxmlElement
    x_tw = int(x_pt * _PT_TO_TWIPS)
    y_tw = int(y_pt * _PT_TO_TWIPS)

    tblPr = tbl._tbl.tblPr
    for old in tblPr.findall(qn('w:tblpPr')):
        tblPr.remove(old)

    tblpPr = OxmlElement('w:tblpPr')
    tblpPr.set(qn('w:horzAnchor'),   'page')
    tblpPr.set(qn('w:vertAnchor'),   'page')
    tblpPr.set(qn('w:tblpX'),        str(x_tw))
    tblpPr.set(qn('w:tblpY'),        str(y_tw))
    tblpPr.set(qn('w:leftFromText'), '0')
    tblpPr.set(qn('w:rightFromText'),'0')
    tblpPr.set(qn('w:topFromText'),  '0')
    tblpPr.set(qn('w:bottomFromText'),'0')
    tblPr.insert(0, tblpPr)


def _make_framed_para(text, x_pt, y_pt, w_pt, h_pt,
                      size_pt, color_hex, bold, italic, font_name, qn):
    """
    Construye un elemento <w:p> con posicionamiento absoluto (framePr)
    respecto al borde de la página.  No requiere objeto doc.
    """
    from docx.oxml import OxmlElement

    p   = OxmlElement('w:p')
    pPr = OxmlElement('w:pPr')

    # Positioning frame
    fp = OxmlElement('w:framePr')
    fp.set(qn('w:w'),       str(max(int(w_pt * _PT_TO_TWIPS), 40)))
    fp.set(qn('w:h'),       str(max(int(h_pt * _PT_TO_TWIPS), 20)))
    fp.set(qn('w:hAnchor'), 'page')
    fp.set(qn('w:vAnchor'), 'page')
    fp.set(qn('w:x'),       str(int(x_pt * _PT_TO_TWIPS)))
    fp.set(qn('w:y'),       str(int(y_pt * _PT_TO_TWIPS)))
    fp.set(qn('w:wrap'),    'through')
    pPr.append(fp)

    # Paragraph spacing: 0 antes y después (no desplaza el flujo)
    sp = OxmlElement('w:spacing')
    sp.set(qn('w:before'), '0')
    sp.set(qn('w:after'),  '0')
    pPr.append(sp)

    p.append(pPr)

    # Run
    r   = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')

    if bold:
        rPr.append(OxmlElement('w:b'))
        rPr.append(OxmlElement('w:bCs'))
    if italic:
        rPr.append(OxmlElement('w:i'))
        rPr.append(OxmlElement('w:iCs'))

    sz_val = str(max(int(size_pt * 2), 8))
    for tag in ('w:sz', 'w:szCs'):
        e = OxmlElement(tag)
        e.set(qn('w:val'), sz_val)
        rPr.append(e)

    if color_hex and color_hex.upper() not in ('000000', ''):
        ce = OxmlElement('w:color')
        ce.set(qn('w:val'), color_hex.upper())
        rPr.append(ce)

    if font_name:
        # Limpiar nombre de fuente (quitar prefijos de subconjunto como "ABCDEF+")
        clean = font_name.split('+')[-1].split(',')[0].strip()
        if clean and len(clean) < 60:
            rf = OxmlElement('w:rFonts')
            for attr in ('w:ascii', 'w:hAnsi', 'w:cs'):
                rf.set(qn(attr), clean)
            rPr.append(rf)

    r.append(rPr)

    wt = OxmlElement('w:t')
    wt.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    wt.text = text
    r.append(wt)

    p.append(r)
    return p


def _body_insert(doc, elem, qn):
    """
    Inserta un elemento XML en el body del documento JUSTO ANTES del
    último <w:sectPr> directo, para que quede en la sección correcta.
    """
    body = doc.element.body
    last_sectPr = None
    for child in body:
        if child.tag == qn('w:sectPr'):
            last_sectPr = child
    if last_sectPr is not None:
        last_sectPr.addprevious(elem)
    else:
        body.append(elem)


def _custom_pdf_to_docx(pdf_path, output_path):
    """
    Motor de conversión PDF→DOCX de alta fidelidad.

    Para cada página del PDF:
      · Tabla    → reconstruida con colores de celda, flotante (tblpPr)
      · Imagen   → párrafo flotante con framePr
      · Texto    → párrafo flotante con framePr (posición exacta, fuente,
                   tamaño, color, negrita/cursiva)

    Al estar todos los elementos posicionados de forma absoluta respecto
    a la página, el resultado replica visualmente el PDF original.
    """
    from docx import Document
    from docx.shared import Emu
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    doc      = Document()
    fitz_doc = fitz.open(pdf_path)

    with pdfplumber.open(pdf_path) as plumber_doc:
        num_pages = len(fitz_doc)

        for page_num in range(num_pages):
            fitz_page    = fitz_doc[page_num]
            plumber_page = plumber_doc.pages[page_num]

            pw = fitz_page.rect.width   # ancho de página en puntos
            ph = fitz_page.rect.height  # alto  de página en puntos

            # ── Configurar sección / página ──────────────────────────────────
            if page_num == 0:
                section = doc.sections[0]
            else:
                section = doc.add_section()

            margin = 18  # 0.25 pulgadas en puntos
            section.page_width    = Emu(_pt_emu(pw))
            section.page_height   = Emu(_pt_emu(ph))
            section.top_margin    = Emu(_pt_emu(margin))
            section.bottom_margin = Emu(_pt_emu(margin))
            section.left_margin   = Emu(_pt_emu(margin))
            section.right_margin  = Emu(_pt_emu(margin))

            # ── Tablas ───────────────────────────────────────────────────────
            table_zones = []  # (x0, top, x1, bottom) para excluir bloques

            # Rectángulos rellenos de esta página (fuente de colores de celda)
            filled_rects = [
                r for r in plumber_page.rects
                if r.get('fill') and r.get('non_stroking_color') is not None
            ]

            for pt_table in plumber_page.find_tables():
                t_x0, t_top, t_x1, t_bot = pt_table.bbox
                table_zones.append((t_x0, t_top, t_x1, t_bot))

                rows_data = pt_table.extract()
                if not rows_data:
                    continue
                nrows = len(rows_data)
                ncols = max((len(r) for r in rows_data), default=0)
                if nrows == 0 or ncols == 0:
                    continue

                tbl = doc.add_table(rows=nrows, cols=ncols)
                tbl.style = 'Table Grid'

                for r_idx in range(nrows):
                    data_row = rows_data[r_idx] if r_idx < len(rows_data) else []
                    p_row    = (pt_table.rows[r_idx]
                                if r_idx < len(pt_table.rows) else None)

                    for c_idx in range(ncols):
                        if c_idx >= len(tbl.rows[r_idx].cells):
                            continue
                        word_cell = tbl.rows[r_idx].cells[c_idx]
                        cell_text = (data_row[c_idx]
                                     if c_idx < len(data_row) else '') or ''

                        # Limpiar párrafo default y poner el texto
                        word_cell.paragraphs[0].clear()
                        word_cell.paragraphs[0].add_run(cell_text)

                        # Color de fondo de celda
                        if p_row and c_idx < len(p_row.cells) and p_row.cells[c_idx]:
                            cx0, ctop, cx1, cbot = p_row.cells[c_idx]
                            for rect in filled_rects:
                                if (abs(rect.get('x0', 0)    - cx0)  < 6 and
                                    abs(rect.get('top', 0)   - ctop) < 6 and
                                    abs(rect.get('x1', 0)    - cx1)  < 6 and
                                    abs(rect.get('bottom', 0)- cbot) < 6):
                                    fill_hex = _color_to_hex(
                                        rect.get('non_stroking_color'))
                                    if fill_hex and fill_hex.upper() not in (
                                            'FFFFFF', 'FEFEFE'):
                                        _set_cell_bgcolor(word_cell, fill_hex, qn)
                                    break

                # Flotar la tabla a su posición exacta del PDF
                _float_table(tbl, t_x0, t_top, qn)

            # ── Imágenes ─────────────────────────────────────────────────────
            for img_tuple in fitz_page.get_images(full=True):
                xref = img_tuple[0]
                try:
                    img_rects = fitz_page.get_image_rects(xref)
                    if not img_rects:
                        continue
                    ir = img_rects[0]
                    if ir.width < 1 or ir.height < 1:
                        continue

                    # Omitir imágenes dentro de zonas de tabla
                    if any(tz[0]-2 <= ir.x0 and ir.x1 <= tz[2]+2 and
                           tz[1]-2 <= ir.y0 and ir.y1 <= tz[3]+2
                           for tz in table_zones):
                        continue

                    base_img = fitz_doc.extract_image(xref)
                    ext      = base_img.get('ext', 'png')

                    with tempfile.NamedTemporaryFile(
                            suffix=f'.{ext}', delete=False) as tmp:
                        tmp.write(base_img['image'])
                        tmp_path = tmp.name

                    try:
                        img_para = doc.add_paragraph()
                        run      = img_para.add_run()
                        run.add_picture(tmp_path,
                                        width=Emu(_pt_emu(ir.width)),
                                        height=Emu(_pt_emu(ir.height)))

                        pPr = img_para._p.get_or_add_pPr()
                        fp  = OxmlElement('w:framePr')
                        fp.set(qn('w:w'),       str(max(int(ir.width  * _PT_TO_TWIPS), 40)))
                        fp.set(qn('w:h'),       str(max(int(ir.height * _PT_TO_TWIPS), 20)))
                        fp.set(qn('w:hAnchor'), 'page')
                        fp.set(qn('w:vAnchor'), 'page')
                        fp.set(qn('w:x'),       str(int(ir.x0 * _PT_TO_TWIPS)))
                        fp.set(qn('w:y'),       str(int(ir.y0 * _PT_TO_TWIPS)))
                        fp.set(qn('w:wrap'),    'through')
                        pPr.append(fp)
                    finally:
                        try:
                            os.unlink(tmp_path)
                        except Exception:
                            pass

                except Exception as img_err:
                    print(f"[Imagen] página {page_num}: {img_err}")

            # ── Texto ─────────────────────────────────────────────────────────
            text_dict = fitz_page.get_text(
                "dict",
                flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
            )

            for block in text_dict.get('blocks', []):
                if block.get('type') != 0:   # 0 = bloque de texto
                    continue

                bx0, by0, bx1, by1 = block['bbox']

                # Saltar bloques que caen dentro de zonas de tabla
                if any(tz[0]-5 <= bx0 and bx1 <= tz[2]+5 and
                       tz[1]-5 <= by0 and by1 <= tz[3]+5
                       for tz in table_zones):
                    continue

                for line in block.get('lines', []):
                    for span in line.get('spans', []):
                        txt = span.get('text', '')
                        if not txt.strip():
                            continue

                        sx0, sy0, sx1, sy1 = span['bbox']
                        size      = max(span.get('size', 12), 4)
                        font      = span.get('font', '')
                        color_int = span.get('color', 0)
                        flags     = span.get('flags', 0)

                        bold   = bool(flags & 16)  # bit 4 → negrita
                        italic = bool(flags & 2)   # bit 1 → cursiva

                        rc = (color_int >> 16) & 0xFF
                        gc = (color_int >>  8) & 0xFF
                        bc =  color_int        & 0xFF
                        hex_color = f"{rc:02X}{gc:02X}{bc:02X}"

                        # Margen extra en ancho para evitar corte de texto
                        w_pt = (sx1 - sx0) + size * 0.6
                        h_pt = (sy1 - sy0) + 2

                        elem = _make_framed_para(
                            txt, sx0, sy0, w_pt, h_pt,
                            size, hex_color, bold, italic, font, qn
                        )
                        _body_insert(doc, elem, qn)

    fitz_doc.close()
    doc.save(output_path)


def _libreoffice_pdf_to_docx(pdf_path, output_path):
    import shutil
    if not shutil.which('libreoffice'):
        raise FileNotFoundError('LibreOffice no encontrado')
    output_dir = os.path.dirname(os.path.abspath(output_path))
    subprocess.run(
        ['libreoffice', '--headless',
         '--convert-to', 'docx:MS Word 2007 XML',
         pdf_path, '--outdir', output_dir],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    base      = os.path.splitext(os.path.basename(pdf_path))[0]
    generated = os.path.join(output_dir, base + '.docx')
    if os.path.exists(generated) and generated != output_path:
        os.replace(generated, output_path)
    elif not os.path.exists(generated):
        raise FileNotFoundError('LibreOffice no generó el archivo de salida')


def convert_to_word_util(pdf_path, output_path):
    """
    Convierte un PDF a DOCX preservando:
      · Posición exacta de cada texto (framed paragraphs absolutos)
      · Fuente, tamaño, color, negrita e cursiva
      · Tablas con colores de celda (tblpPr para posición exacta)
      · Imágenes en su posición original
      · Encabezados, pies de página y textos laterales

    Estrategia de fallback:
      1. Motor propio (PyMuPDF + pdfplumber + python-docx)  ← mejor fidelidad
      2. LibreOffice headless
      3. pdf2docx
    """
    try:
        _custom_pdf_to_docx(pdf_path, output_path)
    except Exception as e:
        print(f"[Motor propio] falló: {e}. Probando LibreOffice...")
        try:
            _libreoffice_pdf_to_docx(pdf_path, output_path)
        except Exception as e2:
            print(f"[LibreOffice] falló: {e2}. Probando pdf2docx...")
            from pdf2docx import Converter
            cv = Converter(pdf_path)
            cv.convert(output_path, start=0, end=None)
            cv.close()


# ═════════════════════════════════════════════════════════════════════════════
# Extraer tablas → Excel
# ═════════════════════════════════════════════════════════════════════════════

def extract_tables_util(pdf_path, output_path):
    with pdfplumber.open(pdf_path) as pdf:
        with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
            tables_found = False
            for i, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                for j, table in enumerate(tables):
                    if not table:
                        continue
                    tables_found = True
                    df = pd.DataFrame(table[1:], columns=table[0])
                    if len(df.columns) > 0:
                        df.columns = [
                            str(col) if col else f"Col_{c_idx}"
                            for c_idx, col in enumerate(df.columns)
                        ]
                    sheet_name = f"Tabla_{i+1}_{j+1}"
                    df.to_excel(writer, sheet_name=sheet_name, index=False)

            if not tables_found:
                pd.DataFrame([["No se encontraron tablas"]]).to_excel(
                    writer, index=False)


# ═════════════════════════════════════════════════════════════════════════════
# Extraer imágenes → ZIP
# ═════════════════════════════════════════════════════════════════════════════

def extract_images_util(pdf_path, zip_output_path):
    pdf_document = fitz.open(pdf_path)
    with zipfile.ZipFile(zip_output_path, 'w') as zipf:
        for page_num in range(len(pdf_document)):
            page       = pdf_document[page_num]
            image_list = page.get_images(full=True)
            for img_index, img in enumerate(image_list):
                xref       = img[0]
                base_image = pdf_document.extract_image(xref)
                image_bytes= base_image["image"]
                image_ext  = base_image["ext"]
                image_filename = f"image_page{page_num+1}_{img_index+1}.{image_ext}"
                zipf.writestr(image_filename, image_bytes)
    pdf_document.close()


# ═════════════════════════════════════════════════════════════════════════════
# Convertir documentos/imágenes → PDF
# ═════════════════════════════════════════════════════════════════════════════

def convert_to_pdf_util(input_path, output_path, ext):
    ext = ext.lower()
    if ext in ['.jpg', '.jpeg', '.png', '.bmp', '.tiff']:
        image = Image.open(input_path)
        if image.mode != 'RGB':
            image = image.convert('RGB')
        image.save(output_path, "PDF", resolution=100.0)
    elif ext in ['.docx', '.doc', '.xlsx', '.xls', '.ppt', '.pptx']:
        output_dir = os.path.dirname(output_path)
        try:
            subprocess.run(
                ['libreoffice', '--headless', '--convert-to', 'pdf',
                 input_path, '--outdir', output_dir],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            base_name     = os.path.splitext(os.path.basename(input_path))[0]
            generated_pdf = os.path.join(output_dir, base_name + '.pdf')
            if os.path.exists(generated_pdf) and generated_pdf != output_path:
                os.rename(generated_pdf, output_path)
        except subprocess.CalledProcessError as e:
            raise Exception(
                f"Fallo en conversión de documento: "
                f"{e.stderr.decode('utf-8', errors='ignore')}")
        except FileNotFoundError:
            raise Exception("LibreOffice no está instalado.")
    else:
        raise ValueError(f"Formato no soportado: {ext}")
