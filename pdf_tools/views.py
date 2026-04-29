import os
import tempfile
from django.shortcuts import render
from django.http import FileResponse, JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
import json as _json
from .utils import merge_pdfs_util, convert_to_word_util, extract_tables_util, extract_images_util, convert_to_pdf_util, extract_text_blocks_util, apply_text_edits_util

def index(request):
    return render(request, 'base.html')

@csrf_exempt
def api_merge_pdfs(request):
    if request.method == 'POST':
        files = request.FILES.getlist('files')
        custom_name = request.POST.get('custom_name', 'merged_document').strip()
        if not custom_name:
            custom_name = 'merged_document'
            
        if not files or len(files) < 2:
            return HttpResponseBadRequest("Need at least 2 PDF files.")

        temp_dir = tempfile.mkdtemp()
        file_paths = []
        for i, f in enumerate(files):
            # Preserving order sent by JS FormData
            path = os.path.join(temp_dir, f"{i}_{f.name}")
            with open(path, 'wb+') as destination:
                for chunk in f.chunks():
                    destination.write(chunk)
            file_paths.append(path)

        output_path = os.path.join(temp_dir, f"{custom_name}.pdf")
        
        try:
            merge_pdfs_util(file_paths, output_path)
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.pdf")
            return response
        except Exception as e:
            return HttpResponseBadRequest(str(e))
    return HttpResponseBadRequest("Invalid request")

@csrf_exempt
def api_to_word(request):
    if request.method == 'POST':
        file = request.FILES.get('file')
        custom_name = request.POST.get('custom_name', 'converted_document').strip()
        mode = request.POST.get('mode', 'auto') # 'auto', 'digital', 'ocr'
        
        if not custom_name:
            custom_name = 'converted_document'
            
        if not file:
            return JsonResponse({"error": "Se necesita un archivo PDF."}, status=400)

        fd, temp_pdf_path = tempfile.mkstemp(suffix='.pdf')
        try:
            with os.fdopen(fd, 'wb') as destination:
                for chunk in file.chunks():
                    destination.write(chunk)

            output_path = temp_pdf_path.replace('.pdf', '.docx')
            convert_to_word_util(temp_pdf_path, output_path, mode=mode)
            
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.docx")
            return response
        except Exception as e:
            import traceback
            error_msg = traceback.format_exc()
            print(f"--- ERROR EN PDF A WORD ---\n{error_msg}")
            return JsonResponse({"error": str(e)}, status=500)
        finally:
            # Limpieza básica (aunque FileResponse mantendrá el archivo abierto hasta que se envíe)
            pass
    return JsonResponse({"error": "Método no permitido"}, status=405)

@csrf_exempt
def api_extract_tables(request):
    if request.method == 'POST':
        file = request.FILES.get('file')
        custom_name = request.POST.get('custom_name', 'extracted_tables').strip()
        if not custom_name:
            custom_name = 'extracted_tables'
            
        if not file:
            return HttpResponseBadRequest("Need a PDF file.")

        fd, temp_pdf_path = tempfile.mkstemp(suffix='.pdf')
        with os.fdopen(fd, 'wb') as destination:
            for chunk in file.chunks():
                destination.write(chunk)

        output_path = temp_pdf_path.replace('.pdf', '.xlsx')
        
        try:
            extract_tables_util(temp_pdf_path, output_path)
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.xlsx")
            return response
        except Exception as e:
            return HttpResponseBadRequest(str(e))
    return HttpResponseBadRequest("Invalid request")

@csrf_exempt
def api_extract_images(request):
    if request.method == 'POST':
        file = request.FILES.get('file')
        custom_name = request.POST.get('custom_name', 'extracted_images').strip()
        if not custom_name:
            custom_name = 'extracted_images'
            
        if not file:
            return HttpResponseBadRequest("Need a PDF file.")

        fd, temp_pdf_path = tempfile.mkstemp(suffix='.pdf')
        with os.fdopen(fd, 'wb') as destination:
            for chunk in file.chunks():
                destination.write(chunk)

        output_path = temp_pdf_path.replace('.pdf', '.zip')
        
        try:
            extract_images_util(temp_pdf_path, output_path)
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.zip")
            return response
        except Exception as e:
            return HttpResponseBadRequest(str(e))
    return HttpResponseBadRequest("Invalid request")

@csrf_exempt
def api_any_to_pdf(request):
    if request.method == 'POST':
        files = request.FILES.getlist('files')
        custom_name = request.POST.get('custom_name', 'converted_document').strip()
        if not custom_name:
            custom_name = 'converted_document'
            
        if not files:
            return JsonResponse({"error": "Se necesita al menos un archivo para convertir."}, status=400)

        temp_dir = tempfile.mkdtemp()
        file_paths = []
        try:
            for i, f in enumerate(files):
                _, ext = os.path.splitext(f.name)
                path = os.path.join(temp_dir, f"input_{i}{ext}")
                with open(path, 'wb+') as destination:
                    for chunk in f.chunks():
                        destination.write(chunk)
                file_paths.append(path)

            output_path = os.path.join(temp_dir, f"{custom_name}.pdf")
            convert_to_pdf_util(file_paths, output_path)
            
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.pdf")
            return response
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)
    return JsonResponse({"error": "Método no permitido"}, status=405)


@csrf_exempt
def api_edit_extract_text(request):
    """Extrae los bloques de texto del PDF y los devuelve como JSON."""
    if request.method == 'POST':
        file = request.FILES.get('file')
        if not file:
            return HttpResponseBadRequest("Se necesita un archivo PDF.")

        fd, temp_path = tempfile.mkstemp(suffix='.pdf')
        try:
            with os.fdopen(fd, 'wb') as dst:
                for chunk in file.chunks():
                    dst.write(chunk)
            pages = extract_text_blocks_util(temp_path)
            return JsonResponse({"pages": pages})
        except Exception as e:
            return HttpResponseBadRequest(str(e))
        finally:
            try:
                os.unlink(temp_path)
            except Exception:
                pass
    return HttpResponseBadRequest("Invalid request")


@csrf_exempt
def api_edit_export_pdf(request):
    """Recibe el PDF original + JSON de ediciones y devuelve el PDF modificado."""
    if request.method == 'POST':
        file = request.FILES.get('file')
        edits_json  = request.POST.get('edits', '[]')
        custom_name = request.POST.get('custom_name', 'documento_editado').strip()
        if not custom_name:
            custom_name = 'documento_editado'
        if not file:
            return HttpResponseBadRequest("Se necesita un archivo PDF.")

        try:
            edits = _json.loads(edits_json)
        except Exception:
            return HttpResponseBadRequest("JSON de ediciones inválido.")

        fd, temp_in = tempfile.mkstemp(suffix='.pdf')
        with os.fdopen(fd, 'wb') as dst:
            for chunk in file.chunks():
                dst.write(chunk)

        temp_out = temp_in.replace('.pdf', '_edited.pdf')
        try:
            apply_text_edits_util(temp_in, temp_out, edits)
            response = FileResponse(
                open(temp_out, 'rb'),
                as_attachment=True,
                filename=f"{custom_name}.pdf"
            )
            return response
        except Exception as e:
            return HttpResponseBadRequest(str(e))
        finally:
            try:
                os.unlink(temp_in)
            except Exception:
                pass
    return HttpResponseBadRequest("Invalid request")
