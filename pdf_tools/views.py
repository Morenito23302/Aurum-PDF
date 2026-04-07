import os
import tempfile
from django.shortcuts import render
from django.http import FileResponse, JsonResponse, HttpResponseBadRequest
from django.views.decorators.csrf import csrf_exempt
from .utils import merge_pdfs_util, convert_to_word_util, extract_tables_util, extract_images_util

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
        if not custom_name:
            custom_name = 'converted_document'
            
        if not file:
            return HttpResponseBadRequest("Need a PDF file.")

        fd, temp_pdf_path = tempfile.mkstemp(suffix='.pdf')
        with os.fdopen(fd, 'wb') as destination:
            for chunk in file.chunks():
                destination.write(chunk)

        output_path = temp_pdf_path.replace('.pdf', '.docx')
        
        try:
            convert_to_word_util(temp_pdf_path, output_path)
            response = FileResponse(open(output_path, 'rb'), as_attachment=True, filename=f"{custom_name}.docx")
            return response
        except Exception as e:
            return HttpResponseBadRequest(str(e))
    return HttpResponseBadRequest("Invalid request")

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
