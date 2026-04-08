# Usar una imagen base ligera de Python
FROM python:3.10-slim

# Evitar que Python escriba archivos .pyc y forzar logs sin buffer
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Instalar dependencias del sistema requeridas para OCR y manipulación de imágenes/PDFs
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    poppler-utils \
    libreoffice \
    libgl1-mesa-glx \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Establecer directorio de trabajo
WORKDIR /app

# Instalar dependencias de Python
COPY requirements.txt /app/
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copiar el código del proyecto
COPY . /app/

# Recolectar archivos estáticos para que Whitenoise los reconozca en producción
RUN python manage.py collectstatic --noinput

# Exponer el puerto
EXPOSE 8000

# Ejecutar Gunicorn
CMD ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
