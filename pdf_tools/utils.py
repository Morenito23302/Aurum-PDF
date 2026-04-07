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

def merge_pdfs_util(file_paths, output_path):
    # PyMuPDF para unir
    result_pdf = fitz.open()
    for fp in file_paths:
        with fitz.open(fp) as doc:
            result_pdf.insert_pdf(doc)
    result_pdf.save(output_path)
    result_pdf.close()

def convert_to_word_util(pdf_path, output_path):
    doc = Document()
    try:
        # Intento con OCR (Requiere Poppler y Tesseract)
        images = convert_from_path(pdf_path)
        for i, image in enumerate(images):
            # OCR con pytesseract
            text = pytesseract.image_to_string(image)
            doc.add_paragraph(text)
            if i < len(images) - 1:
                doc.add_page_break()
    except Exception as e:
        # Fallback a extracción de texto directa si falla el OCR o falta dependencia
        print(f"OCR falló, usando método directo: {e}")
        doc = Document()  # Reset
        pdf = fitz.open(pdf_path)
        for page_num in range(len(pdf)):
            page = pdf[page_num]
            text = page.get_text()
            doc.add_paragraph(text)
            if page_num < len(pdf) - 1:
                doc.add_page_break()
        pdf.close()
        
    doc.save(output_path)

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
