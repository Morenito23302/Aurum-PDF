import os
import json as _json
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

def merge_pdfs_util(file_paths, output_path):
    # PyMuPDF para unir
    result_pdf = fitz.open()
    for fp in file_paths:
        with fitz.open(fp) as doc:
            result_pdf.insert_pdf(doc)
    result_pdf.save(output_path)
    result_pdf.close()

def convert_to_word_util(pdf_path, output_path):
    """
    Convierte un PDF a DOCX conservando el layout exacto: texto, tablas, imágenes,
    fuentes y estilos. Estrategia:
    1. LibreOffice (mejor fidelidad, ya instalado en el servidor)
    2. pdf2docx como fallback
    """
    import shutil

    # ── Estrategia 1: LibreOffice ──────────────────────────────────────────────
    if shutil.which("libreoffice"):
        try:
            output_dir = os.path.dirname(output_path)

            result = subprocess.run(
                [
                    "libreoffice",
                    "--headless",
                    "--infilter=writer_pdf_import",
                    "--convert-to", "docx:MS Word 2007 XML",
                    pdf_path,
                    "--outdir", output_dir,
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )

            # LibreOffice genera el archivo con el mismo nombre base del PDF
            base_name = os.path.splitext(os.path.basename(pdf_path))[0]
            generated = os.path.join(output_dir, base_name + ".docx")

            if os.path.exists(generated):
                if generated != output_path:
                    os.replace(generated, output_path)
                return  # ¡Exitoso!
            else:
                print("LibreOffice no generó el archivo esperado; usando fallback.")
        except subprocess.TimeoutExpired:
            print("LibreOffice tardó demasiado; usando fallback.")
        except subprocess.CalledProcessError as e:
            print(f"LibreOffice falló: {e.stderr.decode('utf-8', errors='ignore')}; usando fallback.")
        except Exception as e:
            print(f"Error inesperado con LibreOffice: {e}; usando fallback.")

    # ── Estrategia 2: pdf2docx ────────────────────────────────────────────────
    try:
        from pdf2docx import Converter
        cv = Converter(pdf_path)
        cv.convert(output_path, start=0, end=None)
        cv.close()
    except Exception as e:
        raise Exception(f"Todos los métodos de conversión fallaron: {e}")


def extract_tables_util(pdf_path, output_path):
    # Usar pdfplumber y pandas
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
                    # Limpiar encabezados si son nulos
                    if len(df.columns) > 0:
                        df.columns = [str(col) if col else f"Col_{c_idx}" for c_idx, col in enumerate(df.columns)]
                    # Guardar cada tabla en una hoja
                    sheet_name = f"Tabla_{i+1}_{j+1}"
                    df.to_excel(writer, sheet_name=sheet_name, index=False)
            
            if not tables_found:
                # Escribir hoja vacía si no hay tablas
                pd.DataFrame([["No se encontraron tablas"]]).to_excel(writer, index=False)

def extract_images_util(pdf_path, zip_output_path):
    pdf_document = fitz.open(pdf_path)
    with zipfile.ZipFile(zip_output_path, 'w') as zipf:
        for page_num in range(len(pdf_document)):
            page = pdf_document[page_num]
            image_list = page.get_images(full=True)
            for img_index, img in enumerate(image_list):
                xref = img[0]
                base_image = pdf_document.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                image_filename = f"image_page{page_num+1}_{img_index+1}.{image_ext}"
                zipf.writestr(image_filename, image_bytes)
    pdf_document.close()

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
            subprocess.run([
                'libreoffice', '--headless', '--convert-to', 'pdf',
                input_path, '--outdir', output_dir
            ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            base_name = os.path.splitext(os.path.basename(input_path))[0]
            generated_pdf = os.path.join(output_dir, base_name + '.pdf')
            if os.path.exists(generated_pdf) and generated_pdf != output_path:
                os.rename(generated_pdf, output_path)
        except subprocess.CalledProcessError as e:
            raise Exception(f"Fallo en conversión de documento: {e.stderr.decode('utf-8', errors='ignore')}")
        except FileNotFoundError:
            raise Exception("LibreOffice no está instalado.")
    else:
        raise ValueError(f"Formato no soportado: {ext}")


def extract_text_blocks_util(pdf_path):
    """Extrae todos los bloques de texto (spans) del PDF con posición, fuente y color."""
    doc = fitz.open(pdf_path)
    result = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        page_dict = page.get_text(
            "dict",
            flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_PRESERVE_LIGATURES
        )
        page_data = {
            "page": page_num,
            "width": round(page.rect.width, 2),
            "height": round(page.rect.height, 2),
            "blocks": []
        }
        counter = 0
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:   # 0 = text, 1 = image
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    color_int = span.get("color", 0)
                    r = (color_int >> 16) & 0xFF
                    g = (color_int >> 8) & 0xFF
                    b = color_int & 0xFF
                    bbox = span["bbox"]
                    page_data["blocks"].append({
                        "id": f"p{page_num}_s{counter}",
                        "text": text,
                        "x0": round(bbox[0], 2),
                        "y0": round(bbox[1], 2),
                        "x1": round(bbox[2], 2),
                        "y1": round(bbox[3], 2),
                        "size": round(span.get("size", 12), 2),
                        "font": span.get("font", "Helvetica"),
                        "color_hex": "#{:02x}{:02x}{:02x}".format(r, g, b),
                        "flags": span.get("flags", 0),
                    })
                    counter += 1
        result.append(page_data)
    doc.close()
    return result


def _map_font(font_name, flags=0):
    """Mapea nombre de fuente del PDF a una de las fuentes base-14 de PyMuPDF."""
    # Quitar prefijo de subset p.ej. "ABCDEF+ArialMT" → "ArialMT"
    name = font_name.split("+")[-1].lower()
    is_bold   = bool(flags & 16) or "bold" in name or "black" in name or "heavy" in name
    is_italic = bool(flags & 2)  or "italic" in name or "oblique" in name or "it" in name

    if any(x in name for x in ["helvetica", "arial", "calibri", "tahoma",
                                 "verdana", "gothic", "futura", "gill"]):
        if is_bold and is_italic: return "helv"   # no helv-bi in base14, use helv
        if is_bold:               return "hebo"
        if is_italic:             return "heoi"
        return "helv"
    elif any(x in name for x in ["times", "palatino", "garamond", "georgia",
                                  "roman", "minion", "caslon"]):
        if is_bold and is_italic: return "tibi"
        if is_bold:               return "tibo"
        if is_italic:             return "tiit"
        return "tiro"
    elif any(x in name for x in ["courier", "mono", "consolas", "menlo",
                                   "inconsolata", "lucidacon"]):
        if is_bold and is_italic: return "cobi"
        if is_bold:               return "cobo"
        if is_italic:             return "coit"
        return "cour"
    return "helv"   # fallback universal


def apply_text_edits_util(pdf_path, output_path, edits):
    """
    Aplica ediciones de texto al PDF:
    - Redacta (borra) el texto original con un rectángulo del color de fondo.
    - Re-inserta el nuevo texto en la misma posición.
    Imágenes, tablas, encabezados, logos y marcas de agua NO se tocan.

    edits: lista de dicts con claves:
        page (int), x0/y0/x1/y1 (float), font (str), flags (int),
        new_text (str), color_hex (str), size (float)
    """
    from collections import defaultdict
    doc = fitz.open(pdf_path)

    page_edits = defaultdict(list)
    for edit in edits:
        page_edits[int(edit["page"])].append(edit)

    for page_num, edit_list in page_edits.items():
        if page_num >= len(doc):
            continue
        page = doc[page_num]

        # --- Paso 1: marcar redacciones ---
        for edit in edit_list:
            rect = fitz.Rect(edit["x0"], edit["y0"], edit["x1"], edit["y1"])
            rect = rect + (-1, -1, 1, 1)   # expandir 1pt para cubrir ascendentes/descendentes
            page.add_redact_annot(rect, fill=(1, 1, 1))
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)

        # --- Paso 2: re-insertar texto ---
        for edit in edit_list:
            new_text = edit.get("new_text", "").strip()
            if not new_text:
                continue   # bloque eliminado intencionalmente

            color_hex = edit.get("color_hex", "#000000").lstrip("#")
            try:
                r = int(color_hex[0:2], 16) / 255.0
                g = int(color_hex[2:4], 16) / 255.0
                b = int(color_hex[4:6], 16) / 255.0
            except Exception:
                r, g, b = 0.0, 0.0, 0.0

            fontname = _map_font(edit.get("font", "Helvetica"), edit.get("flags", 0))
            size     = float(edit.get("size", 12))

            # insert_text usa el punto de baseline (esquina inferior-izquierda del texto)
            page.insert_text(
                fitz.Point(edit["x0"], edit["y1"]),
                new_text,
                fontsize=size,
                fontname=fontname,
                color=(r, g, b),
            )

    doc.save(output_path, garbage=4, deflate=True, clean=True)
    doc.close()
