# Usar una imagen base ligera de Python
FROM python:3.10-slim

# Evitar que Python escriba archivos .pyc y forzar logs sin buffer
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

# Crear directorios para evitar fallo al instalar Java (requerido por LibreOffice) en python:slim
RUN mkdir -p /usr/share/man/man1 /usr/share/man/man2

# Instalar dependencias del sistema requeridas para OCR y manipulación de imágenes/PDFs
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-spa \
    poppler-utils \
    libreoffice \
    libgl1 \
    libglib2.0-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice necesita un HOME para perfiles de usuario
ENV HOME=/tmp

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

# Ejecutar Gunicorn con mayor timeout para procesos largos como OCR
CMD ["gunicorn", "core.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "600"]
