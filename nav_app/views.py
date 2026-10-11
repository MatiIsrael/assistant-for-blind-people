import os
import json
import base64
import uuid
from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone

from .tts_service import get_tts_audio
from .gemini_service import understand_destination, analyze_camera_frame
from .firebase_service import is_firebase_ready, save_navigation_session, log_hazard_event
from .models import NavigationSession

def index(request):
    """
    Renders the accessible voice-first navigation interface.
    """
    context = {
        'gemini_configured': bool(os.environ.get('GEMINI_API_KEY')),
        'firebase_connected': is_firebase_ready(),
    }
    return render(request, 'index.html', context)

def api_tts(request):
    """
    Serves streaming TTS audio for Amharic, Afaan Oromoo, or English.
    GET /api/tts/?text=...&lang=...
    """
    text = request.GET.get('text', '').strip()
    lang = request.GET.get('lang', 'en').strip()

    if not text:
        return JsonResponse({'error': 'No text provided'}, status=400)

    audio_bytes = get_tts_audio(text, lang)
    if not audio_bytes:
        return JsonResponse({'error': 'TTS audio synthesis unavailable for offline mode, use Web Speech'}, status=204)

    response = HttpResponse(audio_bytes, content_type='audio/mpeg')
    response['Cache-Control'] = 'public, max-age=86400'
    response['Content-Length'] = len(audio_bytes)
    return response

@csrf_exempt
def api_destination(request):
    """
    Understands user's spoken destination in any of the 3 languages.
    POST /api/destination/
    Body: {"speech": "...", "language": "am|om|en"}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    user_speech = data.get('speech', '').strip()
    language = data.get('language', 'en').lower()

    if not user_speech:
        return JsonResponse({'error': 'No speech provided'}, status=400)

    # Process with Gemini / Rule parser
    result = understand_destination(user_speech, language)
    session_id = f"trip_{uuid.uuid4().hex[:8]}"

    target_distance = result.get('estimated_meters', 100)

    # Save to local database
    session_obj = NavigationSession.objects.create(
        session_id=session_id,
        language=language,
        destination=result.get('destination', 'Destination'),
        category=result.get('category', 'place'),
        meters_walked=0,
        distance_remaining=target_distance,
        target_distance=target_distance,
        status='active'
    )

    # Sync to Firebase
    firebase_payload = {
        'session_id': session_id,
        'language': language,
        'destination': result.get('destination'),
        'category': result.get('category'),
        'meters_walked': 0,
        'target_distance': target_distance,
        'status': 'active',
        'created_at': timezone.now().isoformat(),
    }
    save_navigation_session(firebase_payload)

    return JsonResponse({
        'session_id': session_id,
        'destination': result.get('destination'),
        'category': result.get('category'),
        'target_distance': target_distance,
        'spoken_confirmation': result.get('spoken_confirmation'),
    })

@csrf_exempt
def api_analyze_frame(request):
    """
    Multimodal Vision: Analyzes a camera frame for obstacles, holes, stairs, people, vehicles.
    POST /api/analyze-frame/
    Body: {"image": "data:image/jpeg;base64,...", "language": "...", "session_id": "...", "meters_walked": 10, "distance_left": 90}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    image_b64 = data.get('image', '')
    language = data.get('language', 'en')
    session_id = data.get('session_id', '')
    meters_walked = int(data.get('meters_walked', 0))
    distance_left = int(data.get('distance_left', 100))

    image_bytes = None
    if image_b64:
        try:
            if ',' in image_b64:
                image_b64 = image_b64.split(',', 1)[1]
            image_bytes = base64.b64decode(image_b64)
        except Exception as e:
            print(f"[Image Decode Error] {e}")

    result = analyze_camera_frame(
        image_bytes=image_bytes,
        language=language,
        meters_walked=meters_walked,
        distance_left=distance_left
    )

    if result.get('hazard_detected') and session_id:
        log_hazard_event(session_id, {
            'hazards': result.get('hazards', []),
            'meters_walked': meters_walked,
            'message': result.get('spoken_message', '')
        })

    return JsonResponse(result)

@csrf_exempt
def api_update_trip(request):
    """
    Updates walking distance and marks arrival.
    POST /api/update-trip/
    Body: {"session_id": "...", "meters_walked": 15, "distance_left": 85, "arrived": false, "language": "en"}
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        data = {}

    session_id = data.get('session_id')
    meters_walked = int(data.get('meters_walked', 0))
    distance_left = int(data.get('distance_left', 0))
    arrived = bool(data.get('arrived', False))
    language = data.get('language', 'en').lower()

    if session_id:
        try:
            session = NavigationSession.objects.filter(session_id=session_id).first()
            if session:
                session.meters_walked = meters_walked
                session.distance_remaining = distance_left
                if arrived:
                    session.status = 'arrived'
                session.save()
        except Exception as e:
            print(f"[DB Update Error] {e}")

        # Update Firebase
        save_navigation_session({
            'session_id': session_id,
            'meters_walked': meters_walked,
            'distance_remaining': distance_left,
            'status': 'arrived' if arrived else 'active'
        })

    # Prepare speech message if arrived
    arrival_message = ""
    if arrived:
        if language in ['am', 'amh']:
            arrival_message = "እንኳን ደስ አለዎት! መዳረሻዎ በሰላም ደርሰዋል።"
        elif language in ['om', 'orm']:
            arrival_message = "Baga gammaddan! Bakka yaaddan nagaan geessaniittu."
        else:
            arrival_message = "Congratulations! You have arrived safely at your destination."

    return JsonResponse({
        'status': 'updated',
        'arrived': arrived,
        'arrival_message': arrival_message
    })

def api_status(request):
    """
    System status endpoint.
    """
    return JsonResponse({
        'service': 'VisionNav Ethiopia Accessibility',
        'gemini_api': bool(os.environ.get('GEMINI_API_KEY')),
        'firebase': is_firebase_ready(),
        'supported_languages': [
            {'code': 'om', 'name': 'Afaan Oromoo'},
            {'code': 'am', 'name': 'አማርኛ (Amharic)'},
            {'code': 'en', 'name': 'English'}
        ]
    })
