from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/merge/', views.api_merge_pdfs, name='api_merge'),
    path('api/to-word/', views.api_to_word, name='api_to_word'),
    path('api/extract-tables/', views.api_extract_tables, name='api_extract_tables'),
    path('api/extract-images/', views.api_extract_images, name='api_extract_images'),
]
