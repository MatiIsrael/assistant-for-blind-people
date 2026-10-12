from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('dashboard/', views.dashboard, name='dashboard'),
    path('api/dashboard-data/', views.api_dashboard_data, name='api_dashboard_data'),
    path('api/caregiver-action/', views.api_caregiver_action, name='api_caregiver_action'),
    path('api/tts/', views.api_tts, name='api_tts'),
    path('api/destination/', views.api_destination, name='api_destination'),
    path('api/analyze-frame/', views.api_analyze_frame, name='api_analyze_frame'),
    path('api/update-trip/', views.api_update_trip, name='api_update_trip'),
    path('api/status/', views.api_status, name='api_status'),
]

